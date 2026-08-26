// Public Demo fixture: nine fully synthetic chat-preference cases.
// The stable IDs are public-only identifiers. No private UID, request ID,
// precise time/place, model identity, or original reviewer metadata is included.
export const demoSummary = {
  total_rows: 10,
  usable_rows: 9,
  excluded_duplicate_rows: 1,
  missing_model_ids: 9,
  missing_dimensions: 9,
  missing_difficulty: 9,
  has_model_ids: false
};

export const demoSamples = [
  {
    id: "demo-001",
    source_uid: "demo-001",
    source_row: 1,
    query: "我准备了很久的分享，现场还是紧张到说乱了。大家说没关系，但我一直觉得自己搞砸了。",
    context: [
      { role: "user", content: "我本来想表现得专业一点，结果越想稳住越容易卡壳。" },
      { role: "assistant", content: "听起来你对这次分享投入很多，所以才会对失误特别敏感。" }
    ],
    response_a: "紧张并不等于你准备得不好。先把事实和感受分开看：你卡壳了，这是事实；你觉得整场都失败了，这是紧张之后的判断。可以先问一位你信任的听众：哪一段最清楚、哪一段需要补充。拿到具体反馈，再决定要不要重做一页讲稿，会比反复责怪自己更有用。",
    response_b: "别想太多，大家很快就会忘记的。下次多练几遍就好了，你肯定没你想得那么差。",
    task_type: "情绪支持",
    human_winner: "A",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-001"
  },
  {
    id: "demo-002",
    source_uid: "demo-002",
    source_row: 2,
    query: "朋友临时取消了我们约好的见面，我知道他可能有事，但还是有点失落。",
    context: [
      { role: "user", content: "这已经是最近第二次了，我不想显得很计较。" }
    ],
    response_a: "那就先别提，成年人临时有事很正常。你自己安排点别的活动，把注意力移开就行。",
    response_b: "失落很正常，因为你在意的不只是这次见面，也在意自己的时间有没有被认真对待。你可以不指责地告诉他：‘我理解临时有事，不过连续取消让我有些落空，下次能不能早点确认？’既表达感受，也给对方一个调整的机会。",
    task_type: "关系沟通",
    human_winner: "B",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-002"
  },
  {
    id: "demo-003",
    source_uid: "demo-003",
    source_row: 3,
    query: "我在写一个漂浮城市的故事，但总觉得设定只有画面，没有真正的冲突。",
    context: [
      { role: "user", content: "城市靠收集云里的能量维持，每个区域的高度都不一样。" },
      { role: "assistant", content: "这个视觉核心很鲜明，可以让高度直接影响资源、身份或安全感。" }
    ],
    response_a: "可以把冲突放在‘谁有权决定城市升降’上：高层区域希望继续上升以避开风暴，低层区域却会因此失去能量。主角不是单纯拯救城市，而是必须在有限时间里公开一套被隐瞒的分配规则。这样高度既是画面，也是制度与选择。",
    response_b: "可以加入一个很强的反派，他想夺走所有能量。主角一路打败守卫，最后阻止城市坠落，故事就会更紧张。",
    task_type: "创意共创",
    human_winner: "A",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-003"
  },
  {
    id: "demo-004",
    source_uid: "demo-004",
    source_row: 4,
    query: "我每天只能抽出半小时学新工具，怎么安排才不会学了又忘？",
    context: [],
    response_a: "每天看半小时教程，坚持一个月就能掌握。最好从头到尾跟着课程走，不要跳章节。",
    response_b: "把半小时拆成三个动作：5 分钟回忆昨天做过什么，20 分钟完成一个很小的真实任务，5 分钟写下今天的错误和明天第一步。每周只设一个可交付成果，比如做出一张图或一个小页面。这样复习、练习和反馈会连在一起。",
    task_type: "学习规划",
    human_winner: "B",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-004"
  },
  {
    id: "demo-005",
    source_uid: "demo-005",
    source_row: 5,
    query: "家里的小动物一听到雷声就躲起来，我应该马上把它抱出来安慰吗？",
    context: [
      { role: "user", content: "它平时愿意靠近我，但害怕时会缩在角落。" }
    ],
    response_a: "先不要强行抱出来。给它保留安全的躲藏处，关好门窗、拉上窗帘，用稳定的环境声减弱雷声。你可以待在附近、轻声说话，让它自己决定要不要靠近。如果出现持续喘气、受伤或长时间无法恢复，再联系专业人员。",
    response_b: "最好马上抱住它，让它知道你在保护它。多摸摸它，等雷声过去就不会害怕了。",
    task_type: "生活建议",
    human_winner: "A",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-005"
  },
  {
    id: "demo-006",
    source_uid: "demo-006",
    source_row: 6,
    query: "同事总在临近下班时把紧急任务发给我，我不想把关系弄僵，该怎么说？",
    context: [
      { role: "user", content: "有些任务确实重要，但也有不少其实可以提前安排。" }
    ],
    response_a: "你可以直接说下班后不处理工作，让他自己想办法。边界必须强硬，不然别人只会越来越过分。",
    response_b: "可以先对事不对人地说明影响：‘我愿意支持真正紧急的事项，但临近下班才收到会挤压检查时间。以后能否在下午提前确认优先级？如果当天临时增加，也请告诉我哪项原计划可以顺延。’这样既保留协作，也把取舍说清楚。",
    task_type: "职场沟通",
    human_winner: "B",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-006"
  },
  {
    id: "demo-007",
    source_uid: "demo-007",
    source_row: 7,
    query: "想安排一个轻松的周末短途行程，两个人都不想赶景点，应该先确定什么？",
    context: [
      { role: "user", content: "我们更在意休息和吃饭，不介意少去几个地方。" }
    ],
    response_a: "先各自写下三个不可妥协项：可接受的路程、预算和最想要的一顿饭。然后只定一个主要活动，住宿尽量靠近它，其余时间留白。这样即使天气变化，也不会因为行程太满而互相催促。",
    response_b: "可以把热门景点都列出来，再按距离排成一条路线。两天尽量多去几个地方，这样才不会觉得白跑一趟。",
    task_type: "行程规划",
    human_winner: "A",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-007"
  },
  {
    id: "demo-008",
    source_uid: "demo-008",
    source_row: 8,
    query: "我坚持了一阵子的习惯又中断了，现在一想到重新开始就觉得很挫败。",
    context: [
      { role: "user", content: "之前连续做得不错，所以这次中断让我特别泄气。" }
    ],
    response_a: "这不代表前面的积累清零了。先把目标缩到‘今天只做两分钟’，完成后就停也可以；再回看中断前发生了什么，是时间变化、任务太大，还是提醒失效。重新设计触发条件，比要求自己立刻回到原强度更稳。",
    response_b: "习惯最重要的就是坚持。你需要给自己定个硬规则，无论多忙都必须完成，不然以后还是会中断。",
    task_type: "习惯支持",
    human_winner: "A",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-008"
  },
  {
    id: "demo-009",
    source_uid: "demo-009",
    source_row: 9,
    query: "对方只回了‘再看看吧’，我不知道这是拒绝，还是还没决定。",
    context: [
      { role: "user", content: "这件事会影响我后面的安排，但我又不想催得太紧。" }
    ],
    response_a: "这通常就是委婉拒绝，你可以按对方不参加来安排，不需要再追问。",
    response_b: "这句话本身不足以判断。你可以把需要决策的时间说清楚：‘没问题，你可以再考虑。我需要在周五前确认安排，如果到时还没确定，我就先按你不参加处理，可以吗？’这样不替对方下结论，也保护了你的时间。",
    task_type: "意图澄清",
    human_winner: "B",
    model_a_id: null,
    model_b_id: null,
    dimension: null,
    difficulty: null,
    risk: null,
    content_hash: "public-demo-009"
  }
];
