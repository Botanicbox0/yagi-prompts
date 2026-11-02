"""Quiet, single-instance TWINGS worker launcher. No scheduler is enabled implicitly.

Secrets enter only through CAMPAIGN_RISK_WORKER_SECRET during configure and are
stored encrypted for the current Windows user with DPAPI. They never enter argv.
"""
import argparse
import base64
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import json
import msvcrt
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

TASK_NAME = 'TWINGS Campaign Risk Worker'
QUIET_RUN = Path('D:/dev/agent-harnesses/windows-background/agent-harness/quiet_run.pyw')
PYTHONW = Path(sys.executable).with_name('pythonw.exe')
DEFAULT_STATE = Path(os.environ['LOCALAPPDATA']) / 'TWINGS' / 'campaign-risk-worker'
NO_WINDOW = subprocess.CREATE_NO_WINDOW


def stamp():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(value, decrypt=False):
    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt.CryptProtectData.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptProtectData.restype = wintypes.BOOL
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), 'TWINGS campaign worker', None, None, None, 1, ctypes.byref(output))
    if not ok:
        raise RuntimeError('secret_protection_failed')
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(output.pbData)


def alive(pid):
    if not isinstance(pid, int) or pid < 1:
        return False
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return ctypes.get_last_error() == 5  # Access denied is conservatively active.
    try:
        exit_code = wintypes.DWORD()
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(exit_code))) and exit_code.value == 259
    finally:
        kernel.CloseHandle(handle)


def read_json(path):
    if not path.exists():
        return None
    if path.stat().st_size > 32_768:
        raise RuntimeError('state_file_too_large')
    return json.loads(path.read_text(encoding='utf-8'))


def configuration(state):
    value = read_json(state / 'config.json')
    if not value:
        raise RuntimeError('configuration_required')
    return value


def configure(args, state):
    secret = os.environ.get('CAMPAIGN_RISK_WORKER_SECRET', '')
    if len(secret) < 32:
        raise RuntimeError('worker_secret_environment_required')
    origin = urllib.parse.urlsplit(args.origin)
    if origin.scheme != 'https' or origin.hostname not in {'twings.app', 'admin.twings.app'} or origin.port or origin.username or origin.password or origin.path not in {'', '/'} or origin.query or origin.fragment:
        raise RuntimeError('approved_production_origin_required')
    repo = Path(args.repo).resolve(strict=True)
    node = shutil.which('node.exe')
    tsx = repo / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'
    worker = repo / 'scripts' / 'campaign-risk-worker.ts'
    if not node or not tsx.is_file() or not worker.is_file() or not QUIET_RUN.is_file() or not PYTHONW.is_file():
        raise RuntimeError('runtime_files_missing')
    if not re.fullmatch(r'[\w.:/-]{1,120}', args.model, re.ASCII) or not re.fullmatch(r'[\w.-]{1,80}', args.worker_id, re.ASCII):
        raise RuntimeError('worker_identity_required')
    # Ciphertext and non-secret configuration only; retain no raw process environment.
    protected = base64.b64encode(dpapi(secret.encode('utf-8'))).decode('ascii')
    atomic_json(state / 'secret.dpapi.json', {'ciphertext': protected})
    atomic_json(state / 'config.json', {'repo': str(repo), 'node': node, 'tsx': str(tsx), 'worker': str(worker),
        'origin': args.origin.rstrip('/'), 'model': args.model, 'worker_id': args.worker_id,
        'quiet_run': str(QUIET_RUN), 'pythonw': str(PYTHONW), 'configured_at': stamp()})
    return {'configured': True, 'scheduled': False, 'secret_present': True}


def claim_lock(state):
    state.mkdir(parents=True, exist_ok=True)
    stream = (state / 'run.lock').open('a+b')
    if stream.seek(0, os.SEEK_END) == 0:
        stream.write(b'0')
        stream.flush()
    stream.seek(0)
    try:
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        stream.close()
        return None
    return stream  # Windows releases the byte-range lock on process termination.


def run_once(state):
    lock = claim_lock(state)
    if lock is None:
        return {'state': 'already_running'}
    try:
        previous = read_json(state / 'run.json') or {}
        # If the manager crashed while quiet_run lived on, preserve that active pass.
        if alive(previous.get('child_pid')):
            return {'state': 'already_running'}
        config = configuration(state)
        encrypted = read_json(state / 'secret.dpapi.json')
        secret = dpapi(base64.b64decode(encrypted['ciphertext']), decrypt=True).decode('utf-8')
        names = ['SystemRoot', 'WINDIR', 'PATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'USERPROFILE', 'COMSPEC']
        child_env = {name: os.environ[name] for name in names if name in os.environ}
        child_env.update({'CAMPAIGN_RISK_WORKER_SECRET': secret, 'CAMPAIGN_RISK_API_ORIGIN': config['origin'],
            'CAMPAIGN_RISK_OLLAMA_MODEL': config['model'], 'CAMPAIGN_RISK_WORKER_ID': config['worker_id']})
        command = [config['pythonw'], config['quiet_run'], '--log', str(state / 'worker.log'), '--',
            config['node'], config['tsx'], config['worker']]
        started = stamp()
        child = subprocess.Popen(command, cwd=config['repo'], env=child_env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
        atomic_json(state / 'run.json', {'state': 'running', 'manager_pid': os.getpid(), 'child_pid': child.pid, 'started_at': started})
        returncode = child.wait()
        result = {'state': 'completed' if returncode == 0 else 'failed', 'returncode': returncode,
            'started_at': started, 'finished_at': stamp()}
        atomic_json(state / 'run.json', result)
        return result
    except Exception:
        result = {'state': 'failed', 'code': 'worker_manager_error', 'finished_at': stamp()}
        if 'child' in locals() and alive(child.pid):
            result['child_pid'] = child.pid
        atomic_json(state / 'run.json', result)
        return result
    finally:
        lock.close()


def task_query():
    result = subprocess.run(['schtasks.exe', '/Query', '/TN', TASK_NAME, '/XML'], capture_output=True,
        text=True, creationflags=NO_WINDOW)
    if result.returncode:
        return {'installed': False}
    import xml.etree.ElementTree as ET
    root = ET.fromstring(result.stdout)
    ns = {'t': 'http://schemas.microsoft.com/windows/2004/02/mit/task'}
    # Task Scheduler omits schema-default settings when exporting XML.
    # Settings.Enabled defaults to true; an explicit false still disables it.
    return {'installed': True, 'enabled': root.findtext('t:Settings/t:Enabled', default='true', namespaces=ns) == 'true'}


def install_task(state):
    configuration(state)
    import xml.etree.ElementTree as ET
    ns = 'http://schemas.microsoft.com/windows/2004/02/mit/task'
    ET.register_namespace('', ns)
    def sub(parent, tag, text=None):
        element = ET.SubElement(parent, '{' + ns + '}' + tag)
        if text is not None:
            element.text = text
        return element
    root = ET.Element('{' + ns + '}Task', {'version': '1.2'})
    triggers = sub(root, 'Triggers')
    trigger = sub(triggers, 'TimeTrigger')
    repetition = sub(trigger, 'Repetition')
    sub(repetition, 'Interval', 'PT2M')
    sub(repetition, 'StopAtDurationEnd', 'false')
    sub(trigger, 'StartBoundary', datetime.now().astimezone().isoformat(timespec='seconds'))
    sub(trigger, 'Enabled', 'true')
    principals = sub(root, 'Principals')
    principal = sub(principals, 'Principal', None)
    principal.set('id', 'Author')
    # InteractiveToken uses the same Windows user/DPAPI identity, with no stored Windows password.
    identity = subprocess.run(['whoami.exe', '/user', '/fo', 'csv', '/nh'], capture_output=True, text=True, check=True, creationflags=NO_WINDOW).stdout
    import csv
    sid = next(csv.reader([identity.strip()]))[1]
    sub(principal, 'UserId', sid)
    sub(principal, 'LogonType', 'InteractiveToken')
    sub(principal, 'RunLevel', 'LeastPrivilege')
    settings = sub(root, 'Settings')
    sub(settings, 'MultipleInstancesPolicy', 'IgnoreNew')
    sub(settings, 'DisallowStartIfOnBatteries', 'false')
    sub(settings, 'StopIfGoingOnBatteries', 'false')
    sub(settings, 'StartWhenAvailable', 'true')
    sub(settings, 'Enabled', 'false')
    sub(settings, 'Hidden', 'true')
    sub(settings, 'ExecutionTimeLimit', 'PT0S')  # One-shot worker has bounded jobs; no orphaning kill timeout.
    actions = sub(root, 'Actions')
    actions.set('Context', 'Author')
    action = sub(actions, 'Exec')
    sub(action, 'Command', str(PYTHONW))
    sub(action, 'Arguments', subprocess.list2cmdline([str(Path(__file__).resolve()), '--state-dir', str(state), 'run']))
    sub(action, 'WorkingDirectory', str(Path(__file__).resolve().parent.parent))
    task_path = state / 'task.xml'
    task_path.write_text(ET.tostring(root, encoding='unicode'), encoding='utf-16')
    subprocess.run(['schtasks.exe', '/Create', '/TN', TASK_NAME, '/XML', str(task_path), '/F'],
        check=True, capture_output=True, creationflags=NO_WINDOW)
    return {'installed': True, 'enabled': False}


def status(state):
    config = read_json(state / 'config.json')
    last = read_json(state / 'run.json')
    active = bool(last and alive(last.get('child_pid')))
    return {'configured': bool(config), 'secret_present': (state / 'secret.dpapi.json').exists(),
        'state_directory': str(state), 'active': active, 'last_run': last,
        'quiet_receipt': read_json(state / 'worker.log.last.json'), 'task': task_query()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=DEFAULT_STATE)
    commands = parser.add_subparsers(dest='command', required=True)
    configure_parser = commands.add_parser('configure')
    configure_parser.add_argument('--repo', required=True)
    configure_parser.add_argument('--origin', default='https://twings.app')
    configure_parser.add_argument('--model', required=True)
    configure_parser.add_argument('--worker-id', required=True)
    for command in ['status', 'run', 'install-disabled', 'disable']:
        commands.add_parser(command)
    enable = commands.add_parser('enable')
    enable.add_argument('--server-ready', action='store_true', required=True)
    args = parser.parse_args()
    state = args.state_dir.resolve()
    if args.command == 'configure':
        result = configure(args, state)
    elif args.command == 'status':
        result = status(state)
    elif args.command == 'run':
        result = run_once(state)
    elif args.command == 'install-disabled':
        result = install_task(state)
    else:
        subprocess.run(['schtasks.exe', '/Change', '/TN', TASK_NAME,
            '/ENABLE' if args.command == 'enable' else '/DISABLE'], check=True, capture_output=True, creationflags=NO_WINDOW)
        result = task_query()
    if sys.stdout is not None:
        print(json.dumps(result, ensure_ascii=True))
    return 1 if result.get('state') == 'failed' else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # Do not expose provider payloads, decrypted credentials, or raw environment values.
        if sys.stdout:
            print(json.dumps({'state': 'failed', 'code': 'worker_manager_error'}))
        sys.exit(1)
