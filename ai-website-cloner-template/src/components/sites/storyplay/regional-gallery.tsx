"use client";
import Image from "next/image";
import Link from "next/link";
import { useUI } from "@/lib/i18n/provider";
export function RegionalGallery({ market }: { market: "china" | "arab" }) {
  const ui = useUI();
  return <Link href="/studio/novels/new" className="regional-gallery"><Image src={`/images/regions/${market}.png`} alt={ui(market === "china" ? "江南雨夜，带着笔记本的年轻作家走过石桥" : "阿拉伯海滨城市的书店门口，建筑师与书商交谈")} width={1536} height={1024} sizes="(max-width: 900px) 92vw, 1100px" /><span>{ui("从一幅画面，展开一个属于你的世界。")}</span></Link>;
}
