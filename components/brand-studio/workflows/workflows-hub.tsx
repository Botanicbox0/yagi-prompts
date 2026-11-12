'use client';

import { useMemo, useState } from 'react';
import type { StudioAllowanceView, StudioAssetView, StudioOutputView } from '@/lib/brand-studio/contracts';
import { creditsLeft, formatCredits } from '@/lib/brand-studio/credits';
import type { McpTokenWire } from '@/lib/brand-studio/mcp/clients';
import {
  WORKFLOW_CATEGORIES,
  type PlaybookStatus,
  type PlaybookWire,
  type RecentRunSummaryWire,
  type WorkflowCategory,
  type WorkflowRunResult,
  type WorkflowWire,
} from '@/lib/brand-studio/workflows/contracts';
import { estimateRecipeCredits } from '@/lib/brand-studio/workflows/starters';
import type { StudioWorkflowsCopy } from '@/messages/studio-workflows';
import { McpConnectModal } from './mcp-connect-modal';
import styles from './workflows.module.css';

export interface WorkflowsHubProps {
  organizationId: string;
  locale: 'ko' | 'en';
  canCreate: boolean;
  mcpOrigin?: string;
  copy: StudioWorkflowsCopy;
  imageStudioHref: string;
  videoStudioHref: string;
  assetsHref: string;
  initialAllowance: StudioAllowanceView;
  initialStarters: WorkflowWire[];
  initialWorkflows: WorkflowWire[];
  initialPlaybooks: PlaybookWire[];
  initialRecentRuns: RecentRunSummaryWire[];
  initialImageAssets: StudioAssetView[];
  initialVideoAssets: StudioAssetView[];
  initialImageOutputs: Array<StudioOutputView & { label: string }>;
  initialMcpTokens: McpTokenWire[];
}

function makeClientReqId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

function parseRefValue(val: string): { assetId?: string; outputId?: string } | null {
  if (!val) return null;
  if (val.startsWith('asset:')) return { assetId: val.slice('asset:'.length) };
  if (val.startsWith('output:')) return { outputId: val.slice('output:'.length) };
  return null;
}

export function WorkflowsHub({
  organizationId,
  locale,
  canCreate,
  mcpOrigin,
  copy,
  imageStudioHref,
  videoStudioHref,
  assetsHref,
  initialAllowance,
  initialStarters,
  initialWorkflows,
  initialPlaybooks,
  initialRecentRuns,
  initialImageAssets,
  initialVideoAssets,
  initialImageOutputs,
  initialMcpTokens,
}: WorkflowsHubProps) {
  const [allowance, setAllowance] = useState<StudioAllowanceView>(initialAllowance);
  const [activeTab, setActiveTab] = useState<'starters' | 'team' | 'guides'>('starters');
  const [categoryFilter, setCategoryFilter] = useState<'all' | WorkflowCategory>('all');

  const [workflows, setWorkflows] = useState<WorkflowWire[]>(initialWorkflows);
  const [playbooks, setPlaybooks] = useState<PlaybookWire[]>(initialPlaybooks);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    initialStarters[0]?.id ?? initialWorkflows[0]?.id ?? null,
  );

  // AI Builder state
  const [builderBrief, setBuilderBrief] = useState('');
  const [buildingAi, setBuildingAi] = useState(false);

  // Runner inputs state
  const [image1Selection, setImage1Selection] = useState('');
  const [video1Selection, setVideo1Selection] = useState('');
  const [subjectInput, setSubjectInput] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [selectedPacks, setSelectedPacks] = useState<Record<string, string[]>>({});
  const [folderInput, setFolderInput] = useState('');
  const [runningWorkflow, setRunningWorkflow] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<WorkflowRunResult | null>(null);

  // Modals
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [recentModalOpen, setRecentModalOpen] = useState(false);
  const [selectedRecentJobId, setSelectedRecentJobId] = useState<string>(initialRecentRuns[0]?.jobId ?? '');
  const [recentTitle, setRecentTitle] = useState('');
  const [recentSummary, setRecentSummary] = useState('');
  const [savingRecent, setSavingRecent] = useState(false);

  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowWire | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customSummary, setCustomSummary] = useState('');
  const [customCategory, setCustomCategory] = useState<WorkflowCategory>('custom');
  const [customGuide, setCustomGuide] = useState('');
  const [customMedium, setCustomMedium] = useState<'image' | 'video'>('image');
  const [customAspect, setCustomAspect] = useState('4:5');
  const [customStepPrompt, setCustomStepPrompt] = useState(
    'Editorial studio visual of {subject} strictly preserving @image1 proportions and key details. {prompt}',
  );
  const [savingCustom, setSavingCustom] = useState(false);

  const [guideModalOpen, setGuideModalOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<PlaybookWire | null>(null);
  const [guideTitle, setGuideTitle] = useState('');
  const [guideTags, setGuideTags] = useState('');
  const [guideBody, setGuideBody] = useState('');
  const [guideInject, setGuideInject] = useState(true);
  const [guideStatus, setGuideStatus] = useState<PlaybookStatus>('published');
  const [savingGuide, setSavingGuide] = useState(false);

  const [bannerError, setBannerError] = useState<string | null>(null);

  const allWorkflows = useMemo(() => [...initialStarters, ...workflows], [initialStarters, workflows]);
  const activeWorkflow = useMemo(
    () => allWorkflows.find((w) => w.id === selectedWorkflowId) ?? null,
    [allWorkflows, selectedWorkflowId],
  );

  const displayedWorkflows = useMemo(() => {
    const base = activeTab === 'starters' ? initialStarters : workflows;
    if (categoryFilter === 'all') return base;
    return base.filter((w) => w.category === categoryFilter);
  }, [activeTab, categoryFilter, initialStarters, workflows]);

  const remainingCreditsFormatted = formatCredits(creditsLeft(allowance.capKrw, allowance.usedKrw), locale);

  function localizedTitle(wf: WorkflowWire): string {
    return locale === 'en' && wf.titleEn ? wf.titleEn : wf.title;
  }

  function localizedSummary(wf: WorkflowWire): string {
    return locale === 'en' && wf.summaryEn ? wf.summaryEn : wf.summary;
  }

  function localizedGuide(wf: WorkflowWire): string {
    return locale === 'en' && wf.recipe.guideEn ? wf.recipe.guideEn : wf.recipe.guide;
  }

  function packsForWorkflow(wf: WorkflowWire): string[] {
    const saved = selectedPacks[wf.id];
    if (saved) return saved;
    const slot = wf.recipe.slots.find((s) => s.key === 'outputs' && s.kind === 'multiselect');
    if (!slot?.options?.length) return wf.recipe.steps.filter((s) => !s.onlyWhenNoImageRef).map((s) => s.packId ?? s.id);
    return slot.options.filter((o) => o.defaultSelected !== false).map((o) => o.id);
  }

  function togglePack(wf: WorkflowWire, packId: string) {
    const current = packsForWorkflow(wf);
    const exists = current.includes(packId);
    const next = exists ? current.filter((p) => p !== packId) : [...current, packId];
    if (next.length === 0) return;
    setSelectedPacks((prev) => ({ ...prev, [wf.id]: next }));
  }

  function mapErrorCode(code?: string): string {
    switch (code) {
      case 'forbidden':
        return copy.errors.forbidden;
      case 'allowance_closed':
        return copy.errors.allowanceClosed;
      case 'allowance_exhausted':
        return copy.errors.allowanceExhausted;
      case 'too_many_running':
        return copy.errors.tooManyRunning;
      case 'reference_missing':
        return copy.errors.referenceMissing;
      case 'invalid':
        return copy.errors.invalid;
      default:
        return copy.errors.failed;
    }
  }

  async function postWorkflowOp(op: string, input: Record<string, unknown>) {
    const response = await fetch('/api/brand-studio/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, input: { organizationId, ...input } }),
    });
    const json = (await response.json()) as Record<string, unknown>;
    return { ok: response.ok && json.ok === true, json };
  }

  async function handleBuildWithAi(e: React.FormEvent) {
    e.preventDefault();
    const brief = builderBrief.trim();
    if (!canCreate || buildingAi || brief.length < 4) return;
    setBuildingAi(true);
    setBannerError(null);
    try {
      const { ok, json } = await postWorkflowOp('build_with_ai', {
        requestId: makeClientReqId('aib'),
        brief,
      });
      if (!ok) {
        setBannerError(mapErrorCode(typeof json.code === 'string' ? json.code : undefined));
        return;
      }
      const created = json.workflow as WorkflowWire;
      setWorkflows((prev) => [created, ...prev.filter((w) => w.id !== created.id)]);
      setActiveTab('team');
      setCategoryFilter('all');
      setSelectedWorkflowId(created.id);
      setLastRunResult(null);
      setBuilderBrief('');
    } catch {
      setBannerError(copy.errors.failed);
    } finally {
      setBuildingAi(false);
    }
  }

  async function handleRunWorkflow() {
    if (!activeWorkflow || !canCreate || runningWorkflow) return;
    setRunningWorkflow(true);
    setBannerError(null);
    setLastRunResult(null);
    try {
      const packs = packsForWorkflow(activeWorkflow);
      const { ok, json } = await postWorkflowOp('run', {
        requestId: makeClientReqId('run'),
        workflowId: activeWorkflow.id,
        inputs: {
          image1Ref: parseRefValue(image1Selection),
          video1Ref: parseRefValue(video1Selection),
          subject: subjectInput.trim() || undefined,
          prompt: promptInput.trim(),
          packs,
          folderName: folderInput.trim() || undefined,
        },
      });
      if (!ok) {
        setBannerError(mapErrorCode(typeof json.code === 'string' ? json.code : undefined));
        return;
      }
      const runRes = json as unknown as WorkflowRunResult;
      setLastRunResult(runRes);
      if (runRes.allowance) setAllowance(runRes.allowance);
    } catch {
      setBannerError(copy.errors.failed);
    } finally {
      setRunningWorkflow(false);
    }
  }

  async function handleSaveFromRecent(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || savingRecent || !selectedRecentJobId || !recentTitle.trim()) return;
    setSavingRecent(true);
    setBannerError(null);
    try {
      const { ok, json } = await postWorkflowOp('save_from_job', {
        requestId: makeClientReqId('sfj'),
        jobId: selectedRecentJobId,
        title: recentTitle.trim(),
        summary: recentSummary.trim(),
      });
      if (!ok) {
        setBannerError(mapErrorCode(typeof json.code === 'string' ? json.code : undefined));
        return;
      }
      const created = json.workflow as WorkflowWire;
      setWorkflows((prev) => [created, ...prev.filter((w) => w.id !== created.id)]);
      setRecentModalOpen(false);
      setRecentTitle('');
      setRecentSummary('');
      setActiveTab('team');
      setSelectedWorkflowId(created.id);
    } catch {
      setBannerError(copy.errors.failed);
    } finally {
      setSavingRecent(false);
    }
  }

  function openNewCustomModal() {
    setEditingWorkflow(null);
    setCustomTitle('');
    setCustomSummary('');
    setCustomCategory('custom');
    setCustomGuide('');
    setCustomMedium('image');
    setCustomAspect('4:5');
    setCustomStepPrompt(
      'Editorial studio visual of {subject} strictly preserving @image1 proportions and key details. {prompt}',
    );
    setCustomModalOpen(true);
  }

  function openEditCustomModal(wf: WorkflowWire) {
    const firstStep = wf.recipe.steps[0];
    setEditingWorkflow(wf);
    setCustomTitle(wf.title);
    setCustomSummary(wf.summary);
    setCustomCategory(wf.category);
    setCustomGuide(wf.recipe.guide);
    setCustomMedium(firstStep?.medium ?? 'image');
    setCustomAspect(firstStep?.aspect ?? '4:5');
    setCustomStepPrompt(firstStep?.promptTemplate ?? '{prompt}');
    setCustomModalOpen(true);
  }

  async function handleSaveCustomWorkflow(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || savingCustom || !customTitle.trim() || !customStepPrompt.trim()) return;
    setSavingCustom(true);
    setBannerError(null);
    const recipe = {
      version: 1 as const,
      guide: customGuide.trim(),
      defaultFolderPattern: `${customTitle.trim().slice(0, 28)} · {subject}`,
      consistencyCheck: customCategory === 'character' ? ('character_sheet' as const) : ('none' as const),
      slots: [
        {
          key: 'image1',
          kind: 'image_ref' as const,
          label: '기준 이미지 (@image1)',
          labelEn: 'Reference image (@image1)',
          required: false,
        },
        {
          key: 'subject',
          kind: 'text' as const,
          label: '대상 · 제품 이름',
          labelEn: 'Subject or product name',
          required: false,
          defaultValue: customTitle.trim().slice(0, 28),
        },
        {
          key: 'prompt',
          kind: 'textarea' as const,
          label: '추가 연출 메모',
          labelEn: 'Styling notes',
          required: false,
        },
        {
          key: 'folderName',
          kind: 'folder' as const,
          label: '공유 폴더명',
          labelEn: 'Shared folder name',
          required: false,
        },
      ],
      steps: [
        {
          id: 'custom_step_1',
          label: `${customTitle.trim().slice(0, 42)} (${customAspect})`,
          medium: customMedium,
          model: customMedium === 'video' ? 'seedance-2.5' : 'nano-banana-pro',
          aspect: customAspect,
          resolution: customMedium === 'video' ? '720p' : '2K',
          ...(customMedium === 'video' ? { seconds: 5, audio: 'ambient' as const } : { count: 1 }),
          promptTemplate: customStepPrompt.trim(),
          useReferenceSlots: ['image1'],
        },
      ],
    };

    try {
      const { ok, json } = editingWorkflow
        ? await postWorkflowOp('update', {
            workflowId: editingWorkflow.id,
            title: customTitle.trim(),
            summary: customSummary.trim(),
            category: customCategory,
            recipe,
          })
        : await postWorkflowOp('create', {
            requestId: makeClientReqId('cwf'),
            title: customTitle.trim(),
            summary: customSummary.trim(),
            category: customCategory,
            source: 'web',
            recipe,
          });

      if (!ok) {
        setBannerError(mapErrorCode(typeof json.code === 'string' ? json.code : undefined));
        return;
      }
      const saved = json.workflow as WorkflowWire;
      setWorkflows((prev) => [saved, ...prev.filter((w) => w.id !== saved.id)]);
      setCustomModalOpen(false);
      setActiveTab('team');
      setSelectedWorkflowId(saved.id);
    } catch {
      setBannerError(copy.errors.failed);
    } finally {
      setSavingCustom(false);
    }
  }

  async function handleDeleteWorkflow(workflowId: string) {
    if (!canCreate) return;
    const { ok } = await postWorkflowOp('delete', { workflowId });
    if (ok) {
      setWorkflows((prev) => prev.filter((w) => w.id !== workflowId));
      if (selectedWorkflowId === workflowId) {
        setSelectedWorkflowId(initialStarters[0]?.id ?? null);
      }
    }
  }

  function openNewGuideModal() {
    setEditingPlaybook(null);
    setGuideTitle('');
    setGuideTags('');
    setGuideBody('');
    setGuideInject(true);
    setGuideStatus('published');
    setGuideModalOpen(true);
  }

  function openEditGuideModal(pb: PlaybookWire) {
    setEditingPlaybook(pb);
    setGuideTitle(pb.title);
    setGuideTags(pb.tags.join(', '));
    setGuideBody(pb.bodyMd);
    setGuideInject(pb.injectDirector);
    setGuideStatus(pb.status);
    setGuideModalOpen(true);
  }

  async function handleSaveGuide(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || savingGuide || !guideTitle.trim()) return;
    setSavingGuide(true);
    setBannerError(null);
    const tags = guideTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);

    try {
      const { ok, json } = await postWorkflowOp('save_playbook', {
        requestId: makeClientReqId('pbk'),
        ...(editingPlaybook ? { playbookId: editingPlaybook.id } : {}),
        title: guideTitle.trim(),
        bodyMd: guideBody.trim(),
        tags,
        injectDirector: guideInject,
        status: guideStatus,
      });
      if (!ok) {
        setBannerError(mapErrorCode(typeof json.code === 'string' ? json.code : undefined));
        return;
      }
      const saved = json.playbook as PlaybookWire;
      setPlaybooks((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      setGuideModalOpen(false);
    } catch {
      setBannerError(copy.errors.failed);
    } finally {
      setSavingGuide(false);
    }
  }

  async function handleTogglePlaybookInject(pb: PlaybookWire) {
    if (!canCreate) return;
    const { ok, json } = await postWorkflowOp('save_playbook', {
      requestId: makeClientReqId('pbi'),
      playbookId: pb.id,
      title: pb.title,
      bodyMd: pb.bodyMd,
      tags: pb.tags,
      injectDirector: !pb.injectDirector,
      status: pb.status,
    });
    if (ok && json.playbook) {
      const saved = json.playbook as PlaybookWire;
      setPlaybooks((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
    }
  }

  async function handleDeletePlaybook(playbookId: string) {
    if (!canCreate) return;
    const { ok } = await postWorkflowOp('delete_playbook', { playbookId });
    if (ok) {
      setPlaybooks((prev) => prev.filter((p) => p.id !== playbookId));
    }
  }

  // Active runner dynamic estimate
  const activePacks = activeWorkflow ? packsForWorkflow(activeWorkflow) : [];
  const hasChosenImageRef = Boolean(image1Selection);
  const runnerEstimatedCredits = activeWorkflow
    ? estimateRecipeCredits(activeWorkflow.recipe, {
        hasImageRef: hasChosenImageRef,
        selectedPacks: activePacks,
      })
    : 0;
  const runnerJobCount = activeWorkflow
    ? activeWorkflow.recipe.steps.filter((s) => {
        if (s.onlyWhenNoImageRef) return !hasChosenImageRef;
        if (s.packId && !activePacks.includes(s.packId)) return false;
        return true;
      }).length
    : 0;

  const activePackSlot = activeWorkflow?.recipe.slots.find((s) => s.key === 'outputs' && s.kind === 'multiselect');
  const activeNeedsVideoRef = Boolean(activeWorkflow?.recipe.slots.some((s) => s.key === 'video1'));

  return (
    <div className={styles.page} data-workflows-hub>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.topbar}>
          <div className={styles.titleGroup}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{copy.title}</h1>
              <span className={styles.creditPill} data-workflows-credits>
                {copy.allowanceLine.replace('{credits}', remainingCreditsFormatted)}
              </span>
            </div>
            <p className={styles.subtitle}>{copy.subtitle}</p>
          </div>

          <div className={styles.headerActions}>
            {canCreate && (
              <>
                <button
                  type="button"
                  data-save-from-job-open
                  className={styles.secondaryBtn}
                  onClick={() => setRecentModalOpen(true)}
                >
                  {copy.header.saveFromRecent}
                </button>
                <button type="button" className={styles.secondaryBtn} onClick={openNewCustomModal}>
                  {copy.header.newCustom}
                </button>
                <button type="button" className={styles.secondaryBtn} onClick={openNewGuideModal}>
                  {copy.header.newGuide}
                </button>
              </>
            )}
            <button
              type="button"
              data-mcp-connect-open
              className={styles.darkBtn}
              onClick={() => setMcpModalOpen(true)}
            >
              {copy.header.connectMcp}
            </button>
          </div>
        </header>

        {/* Hero AI Workflow Builder */}
        <section className={styles.builderHero} data-ai-workflow-builder>
          <div className={styles.builderTop}>
            <div>
              <p className={styles.eyebrow}>{copy.builder.eyebrow}</p>
              <h2 className={styles.builderHeading}>{copy.builder.heading}</h2>
              <p className={styles.builderLead}>{copy.builder.lead}</p>
            </div>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setMcpModalOpen(true)}
            >
              {copy.header.connectMcp}
            </button>
          </div>

          <form className={styles.builderForm} onSubmit={handleBuildWithAi}>
            <input
              type="text"
              value={builderBrief}
              onChange={(e) => setBuilderBrief(e.target.value)}
              placeholder={copy.builder.placeholder}
              className={styles.builderInput}
              disabled={!canCreate || buildingAi}
              maxLength={1600}
            />
            <button
              type="submit"
              className={styles.primaryCta}
              disabled={!canCreate || buildingAi || builderBrief.trim().length < 4}
            >
              {buildingAi ? copy.builder.building : copy.builder.submit}
            </button>
          </form>

          <div className={styles.chipRow}>
            {[copy.builder.chipPerfume, copy.builder.chipLookbook, copy.builder.chipSocial].map((chip) => (
              <button
                key={chip}
                type="button"
                className={styles.promptChip}
                onClick={() => setBuilderBrief(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        </section>

        {bannerError && (
          <div className={styles.errorBanner} role="alert">
            {bannerError}
          </div>
        )}

        {/* Navigation Tabs + Category Filter */}
        <div className={styles.controlsBar}>
          <div className={styles.tabList} role="tablist" aria-label={copy.tabs.label}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'starters'}
              data-workflows-tab="starters"
              className={`${styles.tabBtn} ${activeTab === 'starters' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('starters')}
            >
              <span>{copy.tabs.starters}</span>
              <span className={styles.tabCount}>{initialStarters.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'team'}
              data-workflows-tab="team"
              className={`${styles.tabBtn} ${activeTab === 'team' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('team')}
            >
              <span>{copy.tabs.team}</span>
              <span className={styles.tabCount}>{workflows.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'guides'}
              data-workflows-tab="guides"
              className={`${styles.tabBtn} ${activeTab === 'guides' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('guides')}
            >
              <span>{copy.tabs.guides}</span>
              <span className={styles.tabCount}>{playbooks.length}</span>
            </button>
          </div>

          {activeTab !== 'guides' && (
            <div className={styles.categoryRow}>
              {(['all', ...WORKFLOW_CATEGORIES] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`${styles.catPill} ${categoryFilter === cat ? styles.catPillActive : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {copy.categories[cat]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tab 1 & 2: Starter Templates & Team Workflows + Interactive Runner */}
        {activeTab !== 'guides' ? (
          <div
            className={`${styles.workspaceSplit} ${activeWorkflow ? styles.workspaceSplitOpen : ''}`}
          >
            <div>
              {displayedWorkflows.length === 0 ? (
                <div className={styles.emptyBox}>
                  <h3 className={styles.emptyTitle}>{copy.cards.emptyTeamTitle}</h3>
                  <p className={styles.emptyBody}>{copy.cards.emptyTeamBody}</p>
                </div>
              ) : (
                <div className={styles.cardGrid}>
                  {displayedWorkflows.map((wf) => {
                    const selected = activeWorkflow?.id === wf.id;
                    const visibleSteps = wf.recipe.steps.filter((s) => !s.onlyWhenNoImageRef);
                    return (
                      <article
                        key={wf.id}
                        data-workflow-card={wf.slug}
                        className={`${styles.workflowCard} ${selected ? styles.workflowCardSelected : ''}`}
                      >
                        <div className={styles.cardTop}>
                          <div className={styles.badgeRow}>
                            <div className={styles.badgeGroup}>
                              <span className={`${styles.badge} ${wf.starter ? styles.badgeDark : ''}`}>
                                {copy.sources[wf.source]}
                              </span>
                              <span className={styles.badge}>{copy.categories[wf.category]}</span>
                            </div>
                          </div>

                          <h3 className={styles.cardTitle}>{localizedTitle(wf)}</h3>
                          <p className={styles.cardSummary}>{localizedSummary(wf)}</p>

                          <div className={styles.stepPills}>
                            {visibleSteps.map((st, idx) => (
                              <span key={st.id} className={styles.stepMini}>
                                <span className={styles.stepNum}>{idx + 1}</span>
                                <span>{locale === 'en' && st.labelEn ? st.labelEn : st.label}</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className={styles.cardFooter}>
                          <span className={styles.metaNums}>
                            {copy.cards.stepsCount.replace('{count}', String(wf.stepCount))} ·{' '}
                            {copy.cards.creditsEstimate.replace(
                              '{credits}',
                              formatCredits(wf.estimatedCredits, locale),
                            )}
                          </span>

                          <div className={styles.cardBtnRow}>
                            {!wf.starter && canCreate && (
                              <>
                                <button
                                  type="button"
                                  className={styles.ghostBtn}
                                  onClick={() => openEditCustomModal(wf)}
                                >
                                  {copy.cards.editAction}
                                </button>
                                <button
                                  type="button"
                                  className={styles.ghostBtn}
                                  onClick={() => handleDeleteWorkflow(wf.id)}
                                >
                                  {copy.cards.deleteAction}
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              className={selected ? styles.darkBtn : styles.secondaryBtn}
                              onClick={() => {
                                setSelectedWorkflowId(wf.id);
                                setLastRunResult(null);
                              }}
                            >
                              {copy.cards.openRunner}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Workflow Runner Panel */}
            {activeWorkflow && (
              <aside className={styles.runnerPanel} data-workflow-runner={activeWorkflow.slug}>
                <div className={styles.runnerHeader}>
                  <div>
                    <span className={styles.eyebrow}>{copy.categories[activeWorkflow.category]}</span>
                    <h2 className={styles.runnerTitle}>{localizedTitle(activeWorkflow)}</h2>
                  </div>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setSelectedWorkflowId(null)}
                  >
                    {copy.runner.close}
                  </button>
                </div>

                {localizedGuide(activeWorkflow) && (
                  <p className={styles.runnerGuide}>{localizedGuide(activeWorkflow)}</p>
                )}

                <div>
                  <p className={styles.sectionLabel}>{copy.runner.stepsHeading}</p>
                  <ol className={styles.pipelineList}>
                    {activeWorkflow.recipe.steps
                      .filter((s) => !s.onlyWhenNoImageRef || !hasChosenImageRef)
                      .map((st, idx) => (
                        <li key={st.id} className={styles.pipelineItem}>
                          <div className={styles.pipelineLeft}>
                            <span className={styles.indexPill}>{idx + 1}</span>
                            <span>{locale === 'en' && st.labelEn ? st.labelEn : st.label}</span>
                          </div>
                          <span className={styles.metaNums}>{st.aspect}</span>
                        </li>
                      ))}
                  </ol>
                </div>

                <div className={styles.fieldStack}>
                  <p className={styles.sectionLabel} style={{ margin: 0 }}>
                    {copy.runner.inputsHeading}
                  </p>

                  {activeNeedsVideoRef && (
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="wf-video1-select">
                        {copy.runner.referenceVideoLabel}
                      </label>
                      <select
                        id="wf-video1-select"
                        className={styles.selectInput}
                        value={video1Selection}
                        onChange={(e) => setVideo1Selection(e.target.value)}
                      >
                        <option value="">{copy.runner.pickNone}</option>
                        {initialVideoAssets.map((v) => (
                          <option key={v.id} value={`asset:${v.id}`}>
                            {v.name} {v.seconds ? `(${v.seconds}s)` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className={styles.field}>
                    <div className={styles.badgeRow}>
                      <label className={styles.fieldLabel} htmlFor="wf-image1-select">
                        {copy.runner.referenceImageLabel}
                      </label>
                      <a href={assetsHref} className={styles.ghostBtn}>
                        {copy.runner.uploadInStudio}
                      </a>
                    </div>
                    <select
                      id="wf-image1-select"
                      className={styles.selectInput}
                      value={image1Selection}
                      onChange={(e) => setImage1Selection(e.target.value)}
                    >
                      <option value="">{copy.runner.pickNone}</option>
                      {initialImageAssets.map((a) => (
                        <option key={`a-${a.id}`} value={`asset:${a.id}`}>
                          {a.name}
                        </option>
                      ))}
                      {initialImageOutputs.map((o) => (
                        <option key={`o-${o.id}`} value={`output:${o.id}`}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="wf-subject-input">
                      {copy.runner.characterNameLabel}
                    </label>
                    <input
                      id="wf-subject-input"
                      type="text"
                      className={styles.textInput}
                      value={subjectInput}
                      onChange={(e) => setSubjectInput(e.target.value)}
                      placeholder={copy.runner.characterNamePlaceholder}
                      maxLength={80}
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="wf-prompt-input">
                      {copy.runner.promptLabel}
                    </label>
                    <textarea
                      id="wf-prompt-input"
                      className={styles.textareaInput}
                      value={promptInput}
                      onChange={(e) => setPromptInput(e.target.value)}
                      placeholder={copy.runner.promptPlaceholder}
                      maxLength={2400}
                    />
                  </div>

                  {activePackSlot?.options && activePackSlot.options.length > 0 && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>{copy.runner.packsLabel}</span>
                      <div className={styles.packChecks}>
                        {activePackSlot.options.map((opt) => {
                          const checked = activePacks.includes(opt.id);
                          return (
                            <label key={opt.id} className={styles.packOption}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePack(activeWorkflow, opt.id)}
                              />
                              <span>{locale === 'en' && opt.labelEn ? opt.labelEn : opt.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="wf-folder-input">
                      {copy.runner.folderLabel}
                    </label>
                    <input
                      id="wf-folder-input"
                      type="text"
                      className={styles.textInput}
                      value={folderInput}
                      onChange={(e) => setFolderInput(e.target.value)}
                      placeholder={copy.runner.folderPlaceholder}
                      maxLength={60}
                    />
                  </div>
                </div>

                <div className={styles.runnerFooter}>
                  <div className={styles.estimateBar}>
                    <span>{copy.runner.estimateLabel}</span>
                    <span className={styles.estimateNums}>
                      {copy.runner.estimateValue
                        .replace('{credits}', formatCredits(runnerEstimatedCredits, locale))
                        .replace('{count}', String(runnerJobCount))}
                    </span>
                  </div>

                  {canCreate ? (
                    <button
                      type="button"
                      data-workflow-run-cta
                      className={styles.primaryCta}
                      disabled={runningWorkflow || runnerJobCount === 0}
                      onClick={handleRunWorkflow}
                    >
                      {runningWorkflow ? copy.runner.running : copy.runner.runCta}
                    </button>
                  ) : (
                    <p className={styles.resultBody}>{copy.runner.readOnlyHint}</p>
                  )}

                  {lastRunResult && lastRunResult.workflowId === activeWorkflow.id && (
                    <div className={styles.resultBox} data-workflow-run-result>
                      <p className={styles.resultTitle}>{copy.runner.resultTitle}</p>
                      <p className={styles.resultBody}>
                        {copy.runner.resultBody
                          .replace('{count}', String(lastRunResult.jobs.length))
                          .replace('{folder}', lastRunResult.folder?.name ?? activeWorkflow.title)}
                      </p>
                      {lastRunResult.consistency?.checked && (
                        <p className={styles.metaNums}>
                          {(lastRunResult.consistency.retried
                            ? copy.runner.consistencyRetried
                            : copy.runner.consistencyVerified
                          ).replace('{score}', String(lastRunResult.consistency.score))}
                        </p>
                      )}
                      <div className={styles.cardBtnRow}>
                        <a
                          href={
                            activeWorkflow.category === 'video' ? videoStudioHref : imageStudioHref
                          }
                          className={styles.secondaryBtn}
                        >
                          {activeWorkflow.category === 'video'
                            ? copy.runner.openVideoStudio
                            : copy.runner.openImageStudio}
                        </a>
                        <a href={assetsHref} className={styles.secondaryBtn}>
                          {copy.runner.openAssetsFolder}
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            )}
          </div>
        ) : (
          /* Tab 3: Team Knowledge & Guides (brand_studio_playbooks) */
          <div>
            {playbooks.length === 0 ? (
              <div className={styles.emptyBox}>
                <h3 className={styles.emptyTitle}>{copy.guides.emptyTitle}</h3>
                <p className={styles.emptyBody}>{copy.guides.emptyBody}</p>
                {canCreate && (
                  <button
                    type="button"
                    className={styles.primaryCta}
                    onClick={openNewGuideModal}
                    style={{ marginTop: 8 }}
                  >
                    {copy.header.newGuide}
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.guidesGrid}>
                {playbooks.map((pb) => (
                  <article key={pb.id} className={styles.guideCard} data-playbook-card={pb.id}>
                    <div className={styles.cardTop}>
                      <div className={styles.badgeGroup}>
                        <span className={`${styles.badge} ${pb.injectDirector ? styles.badgeDark : ''}`}>
                          {pb.status === 'draft' ? copy.guides.draftBadge : copy.guides.publishedBadge}
                        </span>
                        {pb.injectDirector && (
                          <span className={styles.badge}>{copy.guides.injectBadge}</span>
                        )}
                        {pb.tags.map((tag) => (
                          <span key={tag} className={styles.badge}>
                            #{tag}
                          </span>
                        ))}
                      </div>

                      <h3 className={styles.cardTitle}>{pb.title}</h3>
                      <p className={styles.guideBodyPreview}>{pb.bodyMd}</p>
                    </div>

                    <div className={styles.cardFooter}>
                      {canCreate ? (
                        <label className={styles.packOption} style={{ padding: '6px 10px', fontSize: 12 }}>
                          <input
                            type="checkbox"
                            data-playbook-inject-toggle={pb.id}
                            checked={pb.injectDirector}
                            onChange={() => handleTogglePlaybookInject(pb)}
                          />
                          <span>{copy.guides.injectToggle}</span>
                        </label>
                      ) : (
                        <span />
                      )}

                      {canCreate && (
                        <div className={styles.cardBtnRow}>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => openEditGuideModal(pb)}
                          >
                            {copy.guides.editAction}
                          </button>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => handleDeletePlaybook(pb.id)}
                          >
                            {copy.guides.deleteAction}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal 1: Save from Recent Run */}
      {recentModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRecentModalOpen(false);
          }}
        >
          <div className={styles.modalDialog}>
            <div className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle}>{copy.recentModal.title}</h2>
                <p className={styles.modalLead}>{copy.recentModal.lead}</p>
              </div>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setRecentModalOpen(false)}
              >
                {copy.recentModal.cancel}
              </button>
            </div>

            {initialRecentRuns.length === 0 ? (
              <p className={styles.resultBody}>{copy.recentModal.empty}</p>
            ) : (
              <form className={styles.fieldStack} onSubmit={handleSaveFromRecent}>
                <div className={styles.surfaceBlock}>
                  {initialRecentRuns.map((run) => {
                    const selected = selectedRecentJobId === run.jobId;
                    return (
                      <button
                        key={run.jobId}
                        type="button"
                        className={`${styles.recentRunItem} ${selected ? styles.recentRunSelected : ''}`}
                        onClick={() => {
                          setSelectedRecentJobId(run.jobId);
                          if (!recentTitle) setRecentTitle(run.prompt.slice(0, 36));
                        }}
                      >
                        <div>
                          <strong>{run.prompt.slice(0, 64) || run.model}</strong>
                          <div className={styles.metaNums}>
                            {run.model} · {run.aspect ?? 'auto'}
                          </div>
                        </div>
                        <span className={styles.badge}>{run.kind}</span>
                      </button>
                    );
                  })}
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{copy.recentModal.titleField}</label>
                  <input
                    type="text"
                    required
                    value={recentTitle}
                    onChange={(e) => setRecentTitle(e.target.value)}
                    placeholder={copy.recentModal.titlePlaceholder}
                    className={styles.builderInput}
                    style={{ background: '#F4F4F5' }}
                    maxLength={120}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{copy.recentModal.summaryField}</label>
                  <input
                    type="text"
                    value={recentSummary}
                    onChange={(e) => setRecentSummary(e.target.value)}
                    placeholder={copy.recentModal.summaryPlaceholder}
                    className={styles.builderInput}
                    style={{ background: '#F4F4F5' }}
                    maxLength={400}
                  />
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setRecentModalOpen(false)}
                  >
                    {copy.recentModal.cancel}
                  </button>
                  <button
                    type="submit"
                    className={styles.primaryCta}
                    disabled={savingRecent || !recentTitle.trim()}
                  >
                    {savingRecent ? copy.recentModal.saving : copy.recentModal.saveCta}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal 2: Create / Edit Custom Team Workflow */}
      {customModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCustomModalOpen(false);
          }}
        >
          <div className={styles.modalDialog}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {editingWorkflow ? copy.customModal.editTitle : copy.customModal.title}
              </h2>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setCustomModalOpen(false)}
              >
                {copy.customModal.cancel}
              </button>
            </div>

            <form className={styles.fieldStack} onSubmit={handleSaveCustomWorkflow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>{copy.customModal.nameLabel}</label>
                <input
                  type="text"
                  required
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={copy.customModal.namePlaceholder}
                  className={styles.textInput}
                  style={{ background: '#F4F4F5' }}
                  maxLength={120}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>{copy.customModal.summaryLabel}</label>
                <input
                  type="text"
                  value={customSummary}
                  onChange={(e) => setCustomSummary(e.target.value)}
                  placeholder={copy.customModal.summaryPlaceholder}
                  className={styles.textInput}
                  style={{ background: '#F4F4F5' }}
                  maxLength={400}
                />
              </div>

              <div className={styles.builderForm}>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.fieldLabel}>{copy.customModal.categoryLabel}</label>
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value as WorkflowCategory)}
                    className={styles.selectInput}
                    style={{ background: '#F4F4F5' }}
                  >
                    {WORKFLOW_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {copy.categories[cat]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.fieldLabel}>{copy.customModal.mediumLabel}</label>
                  <select
                    value={customMedium}
                    onChange={(e) => {
                      const next = e.target.value === 'video' ? 'video' : 'image';
                      setCustomMedium(next);
                      setCustomAspect(next === 'video' ? '9:16' : '4:5');
                    }}
                    className={styles.selectInput}
                    style={{ background: '#F4F4F5' }}
                  >
                    <option value="image">{copy.customModal.mediumImage}</option>
                    <option value="video">{copy.customModal.mediumVideo}</option>
                  </select>
                </div>

                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.fieldLabel}>{copy.customModal.aspectLabel}</label>
                  <select
                    value={customAspect}
                    onChange={(e) => setCustomAspect(e.target.value)}
                    className={styles.selectInput}
                    style={{ background: '#F4F4F5' }}
                  >
                    {(customMedium === 'video'
                      ? ['9:16', '16:9', '1:1', '4:3', '3:4']
                      : ['4:5', '1:1', '16:9', '9:16', '3:4', '4:3']
                    ).map((asp) => (
                      <option key={asp} value={asp}>
                        {asp}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>{copy.customModal.guideLabel}</label>
                <input
                  type="text"
                  value={customGuide}
                  onChange={(e) => setCustomGuide(e.target.value)}
                  placeholder={copy.customModal.guidePlaceholder}
                  className={styles.textInput}
                  style={{ background: '#F4F4F5' }}
                  maxLength={800}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>{copy.customModal.stepPromptLabel}</label>
                <textarea
                  required
                  value={customStepPrompt}
                  onChange={(e) => setCustomStepPrompt(e.target.value)}
                  className={styles.textareaInput}
                  style={{ background: '#F4F4F5' }}
                  maxLength={3200}
                />
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setCustomModalOpen(false)}
                >
                  {copy.customModal.cancel}
                </button>
                <button type="submit" className={styles.primaryCta} disabled={savingCustom}>
                  {savingCustom ? copy.customModal.saving : copy.customModal.saveCta}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Team Knowledge / Playbook Editor */}
      {guideModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGuideModalOpen(false);
          }}
        >
          <div className={styles.modalDialog}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{copy.header.newGuide}</h2>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setGuideModalOpen(false)}
              >
                {copy.guides.cancel}
              </button>
            </div>

            <form className={styles.fieldStack} onSubmit={handleSaveGuide}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>{copy.guides.titleLabel}</label>
                <input
                  type="text"
                  required
                  value={guideTitle}
                  onChange={(e) => setGuideTitle(e.target.value)}
                  placeholder={copy.guides.titlePlaceholder}
                  className={styles.textInput}
                  style={{ background: '#F4F4F5' }}
                  maxLength={120}
                />
              </div>

              <div className={styles.builderForm}>
                <div className={styles.field} style={{ flex: 2 }}>
                  <label className={styles.fieldLabel}>{copy.guides.tagsLabel}</label>
                  <input
                    type="text"
                    value={guideTags}
                    onChange={(e) => setGuideTags(e.target.value)}
                    placeholder={copy.guides.tagsPlaceholder}
                    className={styles.textInput}
                    style={{ background: '#F4F4F5' }}
                  />
                </div>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.fieldLabel}>{copy.guides.statusLabel}</label>
                  <select
                    value={guideStatus}
                    onChange={(e) => setGuideStatus(e.target.value === 'draft' ? 'draft' : 'published')}
                    className={styles.selectInput}
                    style={{ background: '#F4F4F5' }}
                  >
                    <option value="published">{copy.guides.publishedBadge}</option>
                    <option value="draft">{copy.guides.draftBadge}</option>
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.fieldLabel}>{copy.guides.bodyLabel}</label>
                <textarea
                  value={guideBody}
                  onChange={(e) => setGuideBody(e.target.value)}
                  placeholder={copy.guides.bodyPlaceholder}
                  className={styles.textareaInput}
                  style={{ background: '#F4F4F5', minHeight: 140 }}
                  maxLength={12000}
                />
              </div>

              <label className={styles.packOption} style={{ background: '#F4F4F5' }}>
                <input
                  type="checkbox"
                  checked={guideInject}
                  onChange={(e) => setGuideInject(e.target.checked)}
                />
                <span>{copy.guides.injectToggle}</span>
              </label>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setGuideModalOpen(false)}
                >
                  {copy.guides.cancel}
                </button>
                <button type="submit" className={styles.primaryCta} disabled={savingGuide}>
                  {savingGuide ? copy.guides.saving : copy.guides.saveCta}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Multi-Client MCP 1-2-3 Connect Modal */}
      <McpConnectModal
        open={mcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
        organizationId={organizationId}
        canCreate={canCreate}
        locale={locale}
        mcpOrigin={mcpOrigin}
        copy={copy.mcp}
        errorCopy={copy.errors}
        initialTokens={initialMcpTokens}
      />
    </div>
  );
}
