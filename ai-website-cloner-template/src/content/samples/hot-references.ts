import type { OfficialSample } from "./schema";

// Official hot-drama board, observed 2026-10-27. Heat is the displayed board
// value, not the legacy homepage collector's synthetic cross-tab heat score.
export const hotReferences: NonNullable<OfficialSample["reference"]>[] = [
  { rank: 1, title: "和离后我带女儿横扫魔域", heat: "8686万", direction: "玄幻、家庭羁绊、低位反击" },
  { rank: 2, title: "备用联系人（完）", heat: "7053万", direction: "都市爱情、分手后的关系重建" },
  { rank: 3, title: "后妈只想苟，老公非要凑第二季", heat: "6897万", direction: "重组家庭、契约关系、亲子磨合" },
  { rank: 4, title: "持械入宋：第十季", heat: "6806万", direction: "穿越古代、资源博弈、能力破局" },
  { rank: 5, title: "王妈在顾家当保姆后全家只会搞笑了", heat: "6713万", direction: "豪门轻喜剧、身份反差" },
  { rank: 6, title: "退役归来，这个保镖不好惹", heat: "6537万", direction: "都市动作、隐藏实力、保护任务" },
  { rank: 7, title: "婆婆装瘫七年，我高调离婚！", heat: "6471万", direction: "家庭冲突、女性反击、利益拆解" },
  { rank: 8, title: "修仙满级回现代，我让全家横着走", heat: "6443万", direction: "修仙归来、强者护家、现实落差" },
  { rank: 9, title: "反派拿捏！第三季", heat: "6319万", direction: "豪门爱情、对抗人设、关系博弈" },
  { rank: 10, title: "伪人降临！我是全场唯一预言家第四季", heat: "6288万", direction: "规则悬疑、身份危机、限时求生" },
].map(item => ({ ...item, date: "2026-10-27", url: "https://hongguoduanju.com/rank/hot-drama" }));

export function hotReference(rank: number) {
  const reference = hotReferences.find(item => item.rank === rank);
  if (!reference) throw new Error("Unknown reference rank");
  return reference;
}
