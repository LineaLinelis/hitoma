import type { Reply, Thread } from "./shared";

// UI examples only. Never seeded into D1 or represented as verified posts.
export const samples: Thread[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    category: "雑談",
    title: "インターネットに、少し静かな場所がほしかった。",
    body: "誰が言ったかより、何を言ったか。\n肩書きもフォロワー数もない場所で、ただ話してみたい。\n\nみなさんは、どんな場所だと安心して言葉を置けますか。",
    created_at: 1791171000,
    last_reply_at: 1791171000,
    reply_count: 2,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    category: "問い",
    title: "匿名だからこそ、言えることってありますか？",
    body: "ずっと聞いてみたかった、小さな問いです。\n名前がないことで、会話は自由になるのか。それとも、少し不自由になるのか。",
    created_at: 1791167400,
    last_reply_at: 1791167400,
    reply_count: 1,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    category: "暮らし",
    title: "今日、ちょっとよかったこと。",
    body: "いつも通る道の金木犀が咲いていた。\nそれだけで、帰り道が少しよくなった。\n\n大きな出来事じゃなくていいので、ひとつ置いていきませんか。",
    created_at: 1791163800,
    last_reply_at: 1791163800,
    reply_count: 0,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    category: "テクノロジー",
    title: "人間だとわかる。でも、誰かはわからない。",
    body: "人間であることの証明と、個人を特定することを切り離せるのはおもしろい。\nこの仕組みで、インターネットの会話はどう変わるんだろう。",
    created_at: 1791160200,
    last_reply_at: 1791160200,
    reply_count: 0,
  },
];

export const sampleReplies: Record<string, Reply[]> = {
  [samples[0].id]: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      thread_id: samples[0].id,
      body: "答えを急がなくていい場所。書きかけの考えでも、そのまま置けるといいなと思います。",
      created_at: 1791171600,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      thread_id: samples[0].id,
      body: "いいねの数がないと、少し気が楽になる気がします。",
      created_at: 1791172200,
    },
  ],
  [samples[1].id]: [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      thread_id: samples[1].id,
      body: "わからないことを「わからない」と言える。そこから始まる会話が好きです。",
      created_at: 1791168000,
    },
  ],
};
