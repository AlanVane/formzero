/**
 * Assertion table for the submission spam heuristic in app/lib/spam.ts.
 *
 * Run with `tsx scripts/check-spam.ts` (or `npm run check:spam`). No test
 * framework, no network, no database: this only has to pin down which inputs
 * the heuristic classifies and why.
 *
 * Note on "English single words": a bare word like "Website" still matches
 * `token_only_message`, by design. Tightening that rule further would start
 * rejecting real short enquiries, so it is kept conservative. The point of
 * `dropped_submissions` is that this kind of false positive is now recoverable
 * instead of being lost.
 */

import { detectSpam } from "../app/lib/spam";

type Case = {
  /** Short label shown in the table. */
  label: string;
  /** Input rows passed through the same shape the route builds. */
  data: Record<string, unknown>;
  /** What detectSpam must return; null means "let it through". */
  expected: string | null;
};

const cases: Case[] = [
  // --- Terse CJK: the regression this change exists for -------------------
  {
    label: "terse CJK 报价多少",
    data: { name: "张伟", email: "zhang@example.cn", message: "报价多少" },
    expected: null,
  },
  {
    label: "terse CJK 想要一个官网",
    data: { name: "李娜", email: "li@example.cn", message: "想要一个官网" },
    expected: null,
  },
  {
    label: "terse CJK 帮我看看这个",
    data: { name: "王强", email: "wang@example.cn", message: "帮我看看这个" },
    expected: null,
  },
  {
    label: "terse CJK 做个小程序",
    data: { name: "陈静", email: "chen@example.cn", message: "做个小程序" },
    expected: null,
  },
  {
    label: "terse Japanese 見積もりください",
    data: {
      name: "山田",
      email: "yamada@example.jp",
      message: "見積もりください",
    },
    expected: null,
  },
  {
    label: "terse Korean 견적주세요",
    data: { name: "김민", email: "kim@example.kr", message: "견적주세요" },
    expected: null,
  },

  // --- CJK with punctuation ----------------------------------------------
  {
    label: "CJK with fullwidth question mark",
    data: { name: "张伟", email: "zhang@example.cn", message: "报价多少？" },
    expected: null,
  },
  {
    label: "CJK with punctuation and spaces",
    data: {
      name: "李娜",
      email: "li@example.cn",
      message: "做一个官网，预算 5 万",
    },
    expected: null,
  },
  {
    label: "CJK with ASCII digits",
    data: { name: "王强", email: "wang@example.cn", message: "报价多少 123" },
    expected: null,
  },

  // --- Mixed CJK + latin --------------------------------------------------
  {
    label: "mixed CJK+latin with spaces",
    data: {
      name: "陈静",
      email: "chen@example.cn",
      message: "想要一个 Shopify 官网",
    },
    expected: null,
  },
  {
    label: "mixed CJK+latin no spaces",
    data: { name: "陈静", email: "chen@example.cn", message: "做个Shopify站" },
    expected: null,
  },

  // --- English / ASCII ----------------------------------------------------
  {
    label: "one English word (by design: dropped)",
    data: { name: "Jane Doe", email: "jane@example.com", message: "Website" },
    expected: "token_only_message",
  },
  {
    label: "normal English enquiry",
    data: {
      name: "Jane Doe",
      email: "jane@example.com",
      message:
        "Hello, I need a landing page for my bakery. Budget is around $2k.",
    },
    expected: null,
  },
  {
    label: "normal English, one word + punctuation",
    data: {
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Interested.",
    },
    expected: null,
  },
  {
    label: "ASCII garbage token ke0dy2",
    data: { name: "x", email: "x@example.com", message: "ke0dy2" },
    expected: "token_only_message",
  },
  {
    label: "ASCII garbage token with capitals",
    data: { name: "x", email: "x@example.com", message: "Xy7Qw2" },
    expected: "token_only_message",
  },
  {
    label: "ASCII token at the 10-char boundary",
    data: { name: "x", email: "x@example.com", message: "ke0dy2abcd" },
    expected: "token_only_message",
  },
  {
    label: "ASCII token over the 10-char boundary",
    data: { name: "x", email: "x@example.com", message: "abcdefghijk" },
    expected: null,
  },

  // --- URL in name --------------------------------------------------------
  {
    label: "name containing an https URL",
    data: {
      name: "Best SEO https://spam.example",
      email: "seo@example.com",
      message: "hello there",
    },
    expected: "url_in_name",
  },
  {
    label: "name containing a www host",
    data: {
      name: "www.cheap-seo.example",
      email: "seo@example.com",
      message: "",
    },
    expected: "url_in_name",
  },

  // --- Disposable email domains ------------------------------------------
  {
    label: "disposable email mailinator.com",
    data: { name: "Jane", email: "jane@mailinator.com", message: "hi" },
    expected: "disposable_email_domain",
  },
  {
    label: "disposable email yopmail.com (uppercase)",
    data: { name: "Jane", email: "User@YOPMAIL.COM", message: "hi" },
    expected: "disposable_email_domain",
  },
  {
    label: "disposable email sharklasers.com",
    data: { name: "Jane", email: "jane@sharklasers.com", message: "hi" },
    expected: "disposable_email_domain",
  },
  {
    label: "legitimate custom domain",
    data: {
      name: "Jane",
      email: "jane@acme-corp.cn",
      message: "Hello, please send pricing.",
    },
    expected: null,
  },

  // --- URL counting -------------------------------------------------------
  {
    label: "message with exactly 3 URLs",
    data: {
      name: "Jane",
      email: "jane@example.com",
      message: "see https://a.example https://b.example https://c.example",
    },
    expected: "too_many_urls",
  },
  {
    label: "message with exactly 2 URLs",
    data: {
      name: "Jane",
      email: "jane@example.com",
      message: "see https://a.example and https://b.example",
    },
    expected: null,
  },
  {
    label: "1 URL in message + 2 in another field",
    data: {
      name: "Jane",
      email: "jane@example.com",
      message: "site: https://a.example",
      company: "https://b.example https://c.example",
    },
    expected: "too_many_urls",
  },

  // --- Empty and whitespace ----------------------------------------------
  {
    label: "empty message",
    data: { name: "Jane", email: "jane@example.com", message: "" },
    expected: null,
  },
  {
    label: "whitespace-only message",
    data: { name: "Jane", email: "jane@example.com", message: "   " },
    expected: null,
  },
  {
    label: "missing message field",
    data: { name: "Jane", email: "jane@example.com" },
    expected: null,
  },

  // --- Rule precedence ----------------------------------------------------
  {
    label: "url_in_name wins over too_many_urls",
    data: {
      name: "https://spam.example",
      email: "jane@example.com",
      message: "https://a.example https://b.example https://c.example",
    },
    expected: "url_in_name",
  },
];

const format = (value: string | null) =>
  value === null ? "null" : JSON.stringify(value);

let failures = 0;

for (const testCase of cases) {
  const actual = detectSpam(testCase.data);
  const ok = actual === testCase.expected;
  if (!ok) failures += 1;

  const status = ok ? "PASS" : "FAIL";
  const detail = ok
    ? format(actual)
    : `expected ${format(testCase.expected)}, got ${format(actual)}`;
  console.log(`${status}  ${testCase.label.padEnd(42)} ${detail}`);
}

console.log("");
console.log(
  `${cases.length - failures}/${cases.length} cases passed, ${failures} failed`,
);

process.exit(failures === 0 ? 0 : 1);
