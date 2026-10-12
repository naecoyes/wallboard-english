// content.js — 内置内容库。可持续补充；按日期稳定轮换。
// 内容做成 JS 模块而非 JSON，保证 file:// 双击打开时也能加载。

// 每日一句：{ en, zh, note }
export const DAILY = [
  { en: "Could you do me a favor?", zh: "能帮我个忙吗？", note: "开口请求帮助最常用的一句。" },
  { en: "I'll take care of it.", zh: "这事我来处理。", note: "take care of = 负责、处理。" },
  { en: "That sounds like a plan.", zh: "听起来不错，就这么定了。", note: "同意别人的提议时用。" },
  { en: "I'm running a bit late.", zh: "我要迟到一会儿了。", note: "run late = 迟到，进行时表将要发生。" },
  { en: "Let's call it a day.", zh: "今天就到这儿吧。", note: "收工/结束时用，很地道。" },
  { en: "It slipped my mind.", zh: "我给忘了。", note: "slip one's mind = 一时忘记。" },
  { en: "Long time no see. How have you been?", zh: "好久不见，最近怎么样？", note: "寒暄开场白。" },
  { en: "I couldn't agree more.", zh: "我完全同意。", note: "否定+比较级 = 最强的肯定。" },
  { en: "That's not my cup of tea.", zh: "那不是我喜欢的类型。", note: "委婉表达不感兴趣。" },
  { en: "Let's play it by ear.", zh: "我们到时候看情况再说。", note: "play it by ear = 随机应变。" },
  { en: "I'll keep you posted.", zh: "有进展我会告诉你的。", note: "keep sb. posted = 随时通报。" },
  { en: "It's on the tip of my tongue.", zh: "就在嘴边，一时想不起来。", note: "想不起某个词时用。" },
  { en: "Don't take it personally.", zh: "别往心里去。", note: "安慰对方别觉得被针对。" },
  { en: "I'm all ears.", zh: "我洗耳恭听。", note: "表示认真听对方说。" },
  { en: "That makes sense.", zh: "有道理 / 说得通。", note: "日常最常用回应之一。" },
  { en: "Could you walk me through it?", zh: "能带我过一遍吗？", note: "walk through = 逐步讲解。" },
  { en: "It's a piece of cake.", zh: "小菜一碟。", note: "形容事情很简单。" },
  { en: "I'll get back to you on that.", zh: "这事我稍后回复你。", note: "职场高频句。" },
  { en: "Better late than never.", zh: "迟做总比不做好。", note: "谚语。" },
  { en: "Let's get down to business.", zh: "我们开始谈正事吧。", note: "会议开场常用。" },
  { en: "I'm swamped today.", zh: "我今天忙死了。", note: "swamped = 忙得不可开交。" },
  { en: "Take your time, no rush.", zh: "慢慢来，不着急。", note: "宽慰对方。" },
  { en: "It depends on the situation.", zh: "这要看情况。", note: "万能回答句。" },
  { en: "I've been meaning to call you.", zh: "我一直想给你打电话来着。", note: "mean to do = 打算做却还没做。" },
  { en: "Let's touch base next week.", zh: "我们下周碰个头。", note: "touch base = 简短沟通确认。" },
  { en: "That rings a bell.", zh: "这有点印象 / 听着耳熟。", note: "ring a bell = 唤起记忆。" },
  { en: "I'm in the middle of something.", zh: "我正忙着呢。", note: "婉拒打扰。" },
  { en: "Could you say that again?", zh: "能再说一遍吗？", note: "没听清时最礼貌的询问。" },
  { en: "It's no big deal.", zh: "没什么大不了的。", note: "宽慰或轻描淡写。" },
  { en: "We'll cross that bridge when we come to it.", zh: "船到桥头自然直。", note: "谚语，遇到再说。" },
  { en: "I see your point, but...", zh: "我明白你的意思，不过……", note: "礼貌反驳的开头。" },
  { en: "Let's wrap it up.", zh: "我们收尾吧。", note: "wrap up = 总结、结束。" },
  { en: "It's worth a try.", zh: "值得一试。", note: "be worth doing = 值得做。" },
  { en: "I'm looking forward to it.", zh: "我很期待。", note: "look forward to + 名词/动名词。" },
  { en: "Sorry, I didn't catch that.", zh: "抱歉，我没听清。", note: "catch = 听清、听懂。" },
  { en: "Let's not jump to conclusions.", zh: "先别急着下结论。", note: "jump to conclusions = 草率定论。" },
  { en: "It went over my head.", zh: "我没听懂（太难了）。", note: "go over one's head = 理解不了。" },
  { en: "Keep me in the loop.", zh: "有消息同步给我。", note: "in the loop = 知情圈内。" },
  { en: "That's a good point.", zh: "说到点子上了。", note: "认同对方的观点。" },
  { en: "I'll pick you up at seven.", zh: "我七点去接你。", note: "pick up = 开车接人。" },
  { en: "It's up to you.", zh: "你说了算 / 由你决定。", note: "万能表态句。" },
  { en: "I have a lot on my plate.", zh: "我手头事情一大堆。", note: "on one's plate = 待办的事。" },
];

// 专注模式短文：{ title, sentences[], phrases[{en,zh}], question }
export const PASSAGES = [
  {
    title: "Morning Routine",
    sentences: [
      "Every morning, I make my bed before I do anything else.",
      "It only takes a minute, but it gives me a small sense of order.",
      "Then I drink a glass of water and open the window for some fresh air.",
      "These little habits help me start the day on the right foot."
    ],
    phrases: [
      { en: "make my bed", zh: "整理床铺" },
      { en: "a sense of order", zh: "一种秩序感" },
      { en: "on the right foot", zh: "以好的方式（开始）" }
    ],
    question: "What is the first thing you do every morning?"
  },
  {
    title: "At the Coffee Shop",
    sentences: [
      "Hi, what can I get for you today?",
      "I'd like a medium latte, please. Not too sweet.",
      "Sure. For here or to go?",
      "To go, please. I'm in a bit of a hurry."
    ],
    phrases: [
      { en: "What can I get for you?", zh: "您要点什么？" },
      { en: "for here or to go", zh: "在这喝还是带走" },
      { en: "in a hurry", zh: "赶时间" }
    ],
    question: "What do you usually order at a coffee shop?"
  },
  {
    title: "Weekend Plans",
    sentences: [
      "Do you have any plans for the weekend?",
      "I'm thinking about going hiking if the weather holds up.",
      "That sounds great. Which trail are you going to take?",
      "Probably the one by the lake. It's an easy walk with a beautiful view."
    ],
    phrases: [
      { en: "have plans for", zh: "有……的计划" },
      { en: "if the weather holds up", zh: "如果天气好的话" },
      { en: "an easy walk", zh: "轻松的徒步路线" }
    ],
    question: "What are your plans for this weekend?"
  },
  {
    title: "Asking for Directions",
    sentences: [
      "Excuse me, could you tell me how to get to the subway station?",
      "Sure. Go straight for two blocks, then turn left at the bank.",
      "Is it far from here?",
      "Not at all. It's about a five-minute walk."
    ],
    phrases: [
      { en: "how to get to", zh: "怎么去（某地）" },
      { en: "go straight for two blocks", zh: "直走两个街区" },
      { en: "turn left at", zh: "在……处左转" }
    ],
    question: "When did you last ask someone for directions?"
  },
  {
    title: "Talking About Work",
    sentences: [
      "How's work going these days?",
      "Pretty busy. We're launching a new project next month.",
      "That sounds exciting. Are you in charge of it?",
      "Yes, I'm leading a small team, so there's a lot on my plate."
    ],
    phrases: [
      { en: "launch a project", zh: "启动一个项目" },
      { en: "in charge of", zh: "负责" },
      { en: "a lot on my plate", zh: "手头事情很多" }
    ],
    question: "What are you busy with these days?"
  },
  {
    title: "Making an Appointment",
    sentences: [
      "Hello, I'd like to make an appointment with Dr. Lee.",
      "Of course. How about Tuesday at three in the afternoon?",
      "Hmm, I have a meeting then. Do you have anything in the morning?",
      "Let me check... Yes, we have an opening at ten thirty."
    ],
    phrases: [
      { en: "make an appointment", zh: "预约" },
      { en: "How about...?", zh: "……怎么样？" },
      { en: "an opening", zh: "（时间上的）空档" }
    ],
    question: "Have you made any appointments recently?"
  },
  {
    title: "Weather Talk",
    sentences: [
      "Can you believe this weather? It was sunny an hour ago.",
      "I know. The forecast said it would clear up by noon.",
      "Well, I guess we'd better take an umbrella just in case.",
      "Good idea. You never can tell with spring weather."
    ],
    phrases: [
      { en: "the forecast said", zh: "天气预报说" },
      { en: "clear up", zh: "（天气）放晴" },
      { en: "just in case", zh: "以防万一" }
    ],
    question: "What's the weather like where you live today?"
  },
  {
    title: "Ordering Food",
    sentences: [
      "Are you ready to order, or do you need a few more minutes?",
      "I think we're ready. I'll have the grilled salmon.",
      "Excellent choice. Would you like a side salad with that?",
      "Yes, please. And a glass of orange juice."
    ],
    phrases: [
      { en: "Are you ready to order?", zh: "可以点菜了吗？" },
      { en: "I'll have the...", zh: "我要……" },
      { en: "a side salad", zh: "配餐沙拉" }
    ],
    question: "What do you usually order at a restaurant?"
  },
  {
    title: "Small Talk with a Neighbor",
    sentences: [
      "Hi! I just moved in next door. My name's Anna.",
      "Welcome to the neighborhood! Let me know if you need anything.",
      "Actually, could you recommend a good grocery store around here?",
      "There's one on the corner. It's open late and the prices are fair."
    ],
    phrases: [
      { en: "moved in next door", zh: "搬到隔壁" },
      { en: "recommend a good...", zh: "推荐一个好的……" },
      { en: "on the corner", zh: "在拐角处" }
    ],
    question: "Do you know your neighbors well?"
  },
  {
    title: "At the Gym",
    sentences: [
      "How often do you work out?",
      "I try to come three times a week, mostly after work.",
      "Do you follow a specific routine?",
      "Yes, I start with cardio and then move on to weights."
    ],
    phrases: [
      { en: "work out", zh: "锻炼" },
      { en: "three times a week", zh: "一周三次" },
      { en: "move on to", zh: "接着做（下一件事）" }
    ],
    question: "How do you like to exercise?"
  },
  {
    title: "Talking About Movies",
    sentences: [
      "Have you seen any good movies lately?",
      "Yes! I watched a great documentary last night.",
      "What was it about?",
      "It was about deep sea creatures. It really blew my mind."
    ],
    phrases: [
      { en: "lately", zh: "最近" },
      { en: "What was it about?", zh: "讲的什么？" },
      { en: "blew my mind", zh: "让我大开眼界" }
    ],
    question: "What is the last movie you watched?"
  },
  {
    title: "Learning a Language",
    sentences: [
      "Your English has improved a lot. What's your secret?",
      "I practice a little every day instead of cramming once a week.",
      "Does that really work better?",
      "For me it does. Short daily practice keeps everything fresh in my mind."
    ],
    phrases: [
      { en: "What's your secret?", zh: "有什么诀窍？" },
      { en: "a little every day", zh: "每天一点点" },
      { en: "fresh in my mind", zh: "记忆犹新" }
    ],
    question: "What is your favorite way to practice English?"
  },
  {
    title: "Planning a Trip",
    sentences: [
      "I'm planning a trip to Japan next spring.",
      "That's wonderful! How long are you going to stay?",
      "About ten days. I want to visit both Tokyo and Kyoto.",
      "Make sure you book the hotel early. Spring is the busy season."
    ],
    phrases: [
      { en: "planning a trip to", zh: "计划去……旅行" },
      { en: "How long are you going to stay?", zh: "打算待多久？" },
      { en: "the busy season", zh: "旺季" }
    ],
    question: "Where would you like to travel next?"
  },
  {
    title: "Fixing a Problem",
    sentences: [
      "My laptop keeps freezing every time I open too many tabs.",
      "Have you tried restarting it? That usually does the trick.",
      "I did, but it didn't help much.",
      "Then you might want to check how much memory you have left."
    ],
    phrases: [
      { en: "keeps freezing", zh: "总是卡住/死机" },
      { en: "does the trick", zh: "奏效、解决问题" },
      { en: "you might want to", zh: "你不妨……（建议）" }
    ],
    question: "What do you do when your devices have problems?"
  }
];

// 碎片模式快答问题
export const QUICK_QUESTIONS = [
  "What did you eat for breakfast today?",
  "Describe your room in two sentences.",
  "What is the weather like outside right now?",
  "What are you going to do after this?",
  "Name three things you can see around you.",
  "What did you do yesterday evening?",
  "What is your favorite season, and why?",
  "If you had a free afternoon, what would you do?",
  "What is one thing you are good at?",
  "Tell me about a friend of yours.",
  "What food could you eat every day?",
  "What was the last thing you bought?"
];

// 初始卡片包（首次运行导入 SRS）
export const SEED_DECK = [
  { front: "Could you do me a favor?", back: "能帮我个忙吗？", example: "Could you do me a favor and pass the salt?" },
  { front: "I'll take care of it.", back: "这事我来处理。", example: "Don't worry about the report — I'll take care of it." },
  { front: "It slipped my mind.", back: "我给忘了。", example: "Sorry, your birthday completely slipped my mind." },
  { front: "Let's play it by ear.", back: "到时候看情况再说。", example: "I'm not sure about dinner. Let's play it by ear." },
  { front: "That makes sense.", back: "有道理 / 说得通。", example: "You took the earlier train? That makes sense." },
  { front: "I'm running late.", back: "我要迟到了。", example: "Traffic is bad, so I'm running late." },
  { front: "Keep me in the loop.", back: "有消息同步给我。", example: "I won't be at the meeting, but keep me in the loop." },
  { front: "It's up to you.", back: "由你决定。", example: "Chinese or Italian? It's up to you." },
  { front: "I couldn't agree more.", back: "我完全同意。", example: "This plan is too risky. — I couldn't agree more." },
  { front: "Let's call it a day.", back: "今天就到这儿吧。", example: "We've done enough. Let's call it a day." }
];
