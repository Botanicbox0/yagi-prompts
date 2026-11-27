/**
 * Campaign ops (slice C1): mode label, rail labels, 캠페인 & 제작 의뢰 pages,
 * shared process stage copy, and picture labels. Wired into dictionaries as `campaignOps`.
 */
export const campaignOpsEn = {
  mode: {
    label: 'Campaign management',
  },
  rail: {
    campaigns: 'Campaigns',
    production: 'Production requests',
  },
  campaigns: {
    lead: 'Participants make brand videos and post them on social media',
    hero: {
      title: 'Participants make and post\nbrand videos with their own faces',
      body: 'You set the direction and choose how participants are selected. The YAGI team handles everything from recruiting to the report',
      cta: 'Request a campaign',
    },
    how: {
      title: 'How do campaigns work?',
      example: 'Example screen',
    },
    steps: {
      step1: {
        label: 'Brief',
        body: 'You send the goals and schedule, and the YAGI team reviews them',
      },
      step2: {
        label: 'Template',
        body: 'You review and approve the video template the YAGI team made',
      },
      step3: {
        label: 'Recruiting',
        body: 'Participants are recruited on TWINGS',
      },
      step4: {
        label: 'Selection',
        body: 'Select participants yourself or let the YAGI team do it',
      },
      step5: {
        label: 'Making and posting',
        body: 'Participants post their videos on social media, and the YAGI team verifies them',
      },
      step6: {
        label: 'Report',
        body: 'You get a report on post reactions and views',
      },
    },
    list: {
      title: 'All campaigns',
      empty: 'No campaigns found',
    },
  },
  production: {
    lead: 'Ask the YAGI team to produce a video or a custom template',
    hero: {
      title: 'Leave video and custom template\nproduction to the YAGI team',
      body: 'Review storyboards and drafts and leave your feedback here. Track the progress in one place',
      cta: 'Request production',
    },
    how: {
      title: 'How does production work?',
      example: 'Example screen',
    },
    steps: {
      step1: {
        label: 'Request',
        body: 'You send the details, and the YAGI team reviews them',
      },
      step2: {
        label: 'Storyboard',
        body: 'You review and approve the storyboard the YAGI team uploaded',
      },
      step3: {
        label: 'Draft',
        body: 'You watch the draft and leave feedback on specific scenes',
      },
      step4: {
        label: 'Revision',
        body: 'You compare the revised version with the previous one',
      },
      step5: {
        label: 'Done',
        body: 'You receive the final version. The files stay in your assets',
      },
    },
    list: {
      title: 'All requests',
      empty: 'No requests found',
    },
  },
  shared: {
    filterAll: 'All',
    howClose: 'Close',
  },
  pic: {
    brief: {
      title: 'Campaign brief',
      goal: 'Goal',
      video: 'Video',
      schedule: 'Schedule',
      review: 'In review',
    },
    template: {
      title: 'Video template',
      approved: 'Approved',
    },
    recruit: {
      open: 'Recruiting',
      applicants: 'Applicants',
    },
    pick: {
      picked: 'Picked',
      confirmed: 'Confirmed',
    },
    post: {
      posted: 'Post verified',
    },
    report: {
      title: 'Report',
      views: 'Views',
      reactions: 'Reactions',
    },
    request: {
      title: 'Production request',
    },
    board: {
      title: 'Storyboard',
      approve: 'Approve',
    },
    draft: {
      title: 'Draft',
      note: 'Note',
    },
    revise: {
      before: 'Previous',
      after: 'New',
    },
    done: {
      title: 'Final',
      saved: 'Saved to assets',
    },
  },
};

export const campaignOpsKo: typeof campaignOpsEn = {
  mode: {
    label: '캠페인 운영',
  },
  rail: {
    campaigns: '캠페인',
    production: '제작 의뢰',
  },
  campaigns: {
    lead: '참여자가 브랜드 영상을 만들어 SNS에 올려요',
    hero: {
      title: '참여자가 자신의 얼굴이 담긴\n브랜드 영상을 만들어 올려요',
      body: '브랜드가 방향을 정하고 참여자 선정 방식을 선택해요. 모집부터 리포트까지는 야기 팀이 맡아요',
      cta: '새 캠페인 의뢰하기',
    },
    how: {
      title: '캠페인은 어떻게 진행되나요?',
      example: '예시 화면이에요',
    },
    steps: {
      step1: {
        label: '브리프',
        body: '브랜드가 목표와 일정을 적어 의뢰하면 야기 팀이 검토해요',
      },
      step2: {
        label: '템플릿',
        body: '야기 팀이 만든 영상 템플릿을 확인하고 승인해요',
      },
      step3: {
        label: '모집',
        body: 'TWINGS에서 캠페인 참여자를 모집해요',
      },
      step4: {
        label: '선정',
        body: '후보를 보고 직접 선정하거나 야기 팀에 맡겨요',
      },
      step5: {
        label: '제작·게시',
        body: '참여자가 영상을 만들어 SNS에 올리고 야기 팀이 확인해요',
      },
      step6: {
        label: '리포트',
        body: '게시물 반응과 조회수를 리포트로 받아요',
      },
    },
    list: {
      title: '전체 캠페인',
      empty: '조건에 맞는 캠페인이 없어요',
    },
  },
  production: {
    lead: '야기 팀에 영상이나 전용 템플릿 제작을 맡겨요',
    hero: {
      title: '영상과 전용 템플릿 제작을\n야기 팀에 맡겨보세요',
      body: '스토리보드와 시안을 확인하고 의견을 남길 수 있어요. 진행 상황을 한눈에 확인해요',
      cta: '새 제작 의뢰하기',
    },
    how: {
      title: '제작 의뢰는 어떻게 진행되나요?',
      example: '예시 화면이에요',
    },
    steps: {
      step1: {
        label: '의뢰 접수',
        body: '만들고 싶은 내용을 적어 보내면 야기 팀이 검토해요',
      },
      step2: {
        label: '스토리보드',
        body: '야기 팀이 올린 스토리보드를 확인하고 승인해요',
      },
      step3: {
        label: '시안',
        body: '시안 영상을 보며 원하는 장면에 의견을 남겨요',
      },
      step4: {
        label: '수정',
        body: '의견이 반영된 새 버전을 이전 버전과 비교해요',
      },
      step5: {
        label: '완료',
        body: '완성본을 받아요. 파일은 에셋에 남아요',
      },
    },
    list: {
      title: '전체 의뢰',
      empty: '조건에 맞는 의뢰가 없어요',
    },
  },
  shared: {
    filterAll: '전체',
    howClose: '닫기',
  },
  pic: {
    brief: {
      title: '캠페인 브리프',
      goal: '목표',
      video: '원하는 영상',
      schedule: '일정',
      review: '검토 중',
    },
    template: {
      title: '영상 템플릿',
      approved: '승인',
    },
    recruit: {
      open: '모집 중',
      applicants: '지원자',
    },
    pick: {
      picked: '선택',
      confirmed: '확정',
    },
    post: {
      posted: '게시 확인',
    },
    report: {
      title: '리포트',
      views: '조회수',
      reactions: '반응',
    },
    request: {
      title: '제작 의뢰',
    },
    board: {
      title: '스토리보드',
      approve: '승인하기',
    },
    draft: {
      title: '시안',
      note: '의견',
    },
    revise: {
      before: '이전 버전',
      after: '새 버전',
    },
    done: {
      title: '완성본',
      saved: '에셋에 저장됨',
    },
  },
};

export type CampaignOpsCopy = typeof campaignOpsEn;
