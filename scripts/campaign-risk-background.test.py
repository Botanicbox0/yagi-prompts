"""Local-only launcher regressions. Never invoke the TWINGS worker or Slack."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('risk_background', Path(__file__).with_name('campaign-risk-background.py'))
manager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manager)


class QuietWorkerTests(unittest.TestCase):
    def test_dpapi_round_trip_without_plaintext(self):
        secret = b'synthetic-test-secret-not-a-real-token-12345'
        cipher = manager.dpapi(secret)
        self.assertNotIn(secret, cipher)
        self.assertEqual(manager.dpapi(cipher, decrypt=True), secret)

    def test_windows_lock_blocks_overlap_and_releases(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            first = manager.claim_lock(state)
            self.assertIsNotNone(first)
            self.assertIsNone(manager.claim_lock(state))
            first.close()
            third = manager.claim_lock(state)
            self.assertIsNotNone(third)
            third.close()

    def test_quiet_receipt_and_duplicate_process_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            manager.atomic_json(state / 'config.json', {
                'repo': temporary, 'node': sys.executable, 'tsx': '-c',
                'worker': 'import time;time.sleep(1)', 'origin': 'https://twings.app',
                'model': 'synthetic:model', 'worker_id': 'synthetic-test',
                'quiet_run': str(manager.QUIET_RUN), 'pythonw': str(manager.PYTHONW)})
            manager.atomic_json(state / 'secret.dpapi.json', {'ciphertext': base64.b64encode(manager.dpapi(b'synthetic-test-secret-12345678901234567890')).decode('ascii')})
            command = [sys.executable, str(Path(manager.__file__)), '--state-dir', temporary, 'run']
            first = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
            deadline = time.monotonic() + 5
            while not (state / 'run.json').exists() and time.monotonic() < deadline:
                time.sleep(.02)
            second = subprocess.run(command, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=5)
            self.assertEqual(json.loads(second.stdout)['state'], 'already_running')
            output, error = first.communicate(timeout=10)
            self.assertEqual(first.returncode, 0, error)
            self.assertEqual(json.loads(output)['state'], 'completed')
            receipt = manager.read_json(state / 'worker.log.last.json')
            self.assertEqual(receipt['returncode'], 0)
            self.assertNotIn('secret', json.dumps(receipt))
            self.assertFalse(manager.alive(2147483647))
            self.assertTrue(manager.alive(os.getpid()))


if __name__ == '__main__':
    unittest.main()
