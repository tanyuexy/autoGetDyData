export interface ComposeSegmentInput {
  id: string;
  name: string;
  videoUrl: string;
}

export interface ComposeGroupInput {
  name: string;
  segments: ComposeSegmentInput[];
}

export type ComposeMode = "sequential" | "random";

export interface SequentialComposeRequest {
  mode: "sequential";
  segments: ComposeSegmentInput[];
  addBackgroundMusic?: boolean;
}

export interface RandomComposeRequest {
  mode: "random";
  groups: ComposeGroupInput[];
  outputCount: number;
  orderRule?: string;
  addBackgroundMusic?: boolean;
}

export type ComposeRequest = SequentialComposeRequest | RandomComposeRequest;

export interface ComposeFilmResult {
  videoUrl: string;
  segmentCount: number;
  mode: ComposeMode;
  comboIndex?: number;
  backgroundMusic?: string | null;
  segments: ComposeSegmentInput[];
}

export interface ComposeBatchResult {
  mode: ComposeMode;
  films: ComposeFilmResult[];
  generated: number;
}

export function parsePrefixOrder(orderText: string, maxCount: number): number[] {
  if (!orderText || !orderText.trim()) return [];
  const numbers = orderText
    .split(/[-,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  if (numbers.length > maxCount) {
    throw new Error(`顺序数量不能超过分组数量（${maxCount}）`);
  }
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > maxCount)) {
    throw new Error(`顺序仅支持 1~${maxCount} 的整数`);
  }
  if (new Set(numbers).size !== numbers.length) {
    throw new Error("顺序中不能包含重复编号");
  }
  return numbers.map((n) => n - 1);
}

export function inferComposeGroup(name: string, composeGroup?: string | null): string {
  const manual = String(composeGroup || "").trim();
  if (manual) return manual;
  const bracket = name.match(/^\[(.+?)\]/);
  if (bracket?.[1]) return bracket[1].trim();
  const slash = name.match(/^([^/\\]+)[/\\]/);
  if (slash?.[1]) return slash[1].trim();
  return "";
}

export function buildComposeGroupsFromClips(
  clips: Array<{ id: string; name: string; videoUrl?: string | null; composeGroup?: string | null }>
): ComposeGroupInput[] {
  const grouped = new Map<string, ComposeSegmentInput[]>();
  for (const clip of clips) {
    if (!clip.videoUrl) continue;
    const groupName = inferComposeGroup(clip.name, clip.composeGroup);
    if (!groupName) continue;
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName)!.push({
      id: clip.id,
      name: clip.name,
      videoUrl: clip.videoUrl,
    });
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN"))
    .map(([name, segments]) => ({ name, segments }));
}

function factorialBigInt(n: number): bigint {
  let result = BigInt(1);
  for (let i = 2; i <= n; i += 1) {
    result *= BigInt(i);
  }
  return result;
}

export function computeMaxRandomCombinations(
  groups: ComposeGroupInput[],
  orderRule?: string
): bigint {
  if (!groups.length) return BigInt(0);
  if (groups.some((group) => group.segments.length === 0)) return BigInt(0);

  let prefixOrder: number[] = [];
  try {
    prefixOrder = parsePrefixOrder(orderRule || "", groups.length);
  } catch {
    return BigInt(0);
  }

  const remainingFolderCount = groups.length - prefixOrder.length;
  const orderCombinations = factorialBigInt(remainingFolderCount);
  const clipCombinations = groups.reduce((acc, group) => acc * BigInt(group.segments.length), BigInt(1));
  return orderCombinations * clipCombinations;
}

function shuffle<T>(arr: T[]): T[] {
  const copied = [...arr];
  for (let i = copied.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function buildOrder(prefixOrder: number[], groupCount: number) {
  const all = Array.from({ length: groupCount }, (_, idx) => idx);
  const remaining = all.filter((idx) => !prefixOrder.includes(idx));
  return [...prefixOrder, ...shuffle(remaining)];
}

function buildUniqueKey(order: number[], segmentIds: string[]) {
  return `${order.join(",")}::${segmentIds.join("|")}`;
}

export function generateRandomCombos(
  groups: ComposeGroupInput[],
  outputCount: number,
  orderRule?: string
): Array<{ order: number[]; segments: ComposeSegmentInput[] }> {
  const prefixOrder = parsePrefixOrder(orderRule || "", groups.length);
  const usedCombinations = new Set<string>();
  const combos: Array<{ order: number[]; segments: ComposeSegmentInput[] }> = [];

  for (let i = 0; i < outputCount; i += 1) {
    let picked: { order: number[]; segments: ComposeSegmentInput[] } | null = null;
    for (let retry = 0; retry < 500 && !picked; retry += 1) {
      const order = buildOrder(prefixOrder, groups.length);
      const segments = order.map((groupIdx) => pickRandom(groups[groupIdx].segments));
      const uniqueKey = buildUniqueKey(order, segments.map((segment) => segment.id));
      if (usedCombinations.has(uniqueKey)) continue;
      picked = { order, segments };
    }
    if (!picked) {
      throw new Error(
        `无法生成第 ${i + 1} 个可用组合：候选组合已耗尽，请减少产出数量或增加各分组片段数`
      );
    }
    usedCombinations.add(buildUniqueKey(picked.order, picked.segments.map((segment) => segment.id)));
    combos.push(picked);
  }

  return combos;
}
