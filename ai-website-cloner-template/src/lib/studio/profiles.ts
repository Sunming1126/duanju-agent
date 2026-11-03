import type { Market } from "@/lib/i18n/config";
import type { ContentType } from "./api";
import { novelGenres, dramaGenres } from "./writing";

export const defaultCore = ["重生逆袭", "穿越", "先婚后爱", "双向救赎", "身份反转", "时间循环", "异能觉醒", "成长冒险"];
export const defaultStyles = ["轻松幽默", "情感细腻", "悬疑烧脑", "节奏紧凑", "温暖治愈", "热血", "现实质感", "浪漫"];
export const taiwanProfile = {
  novel: ["青春校园", "都会爱情", "婚姻家庭", "职场成长", "社会写实", "犯罪推理", "心理悬疑", "民俗灵异", "都市奇幻", "东方奇幻", "武侠仙侠", "历史架空", "科幻", "BL", "GL", "其他"],
  short_drama: ["校园青春", "都会爱情", "婚姻家庭", "职场", "社会悬疑", "犯罪推理", "民俗奇幻", "轻喜剧", "古装奇幻", "BL", "GL", "其他"],
  core: ["久别重逢", "先婚后爱", "双向救赎", "返乡重启", "家庭秘密", "身份错位", "时间循环", "重生改命", "跨代关系", "成长冒险"],
  styles: ["生活感", "情感细腻", "轻松幽默", "温暖疗愈", "现实质感", "浪漫", "悬疑紧张", "节奏明快", "群像叙事", "青春成长"],
};
const profiles = { taiwan: taiwanProfile };
export function creativeProfile(market: Market | undefined, type: ContentType) {
  const profile = market && market in profiles ? profiles[market as keyof typeof profiles] : undefined;
  return { genres: profile ? profile[type] : type === "novel" ? novelGenres : dramaGenres,
    core: profile?.core || defaultCore, styles: profile?.styles || defaultStyles };
}
