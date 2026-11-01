"use client";
import { useUI } from "@/lib/i18n/provider";


import { useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { conceptImage, type StoryConcept } from "./story-concepts";

export function ConceptPoster({
  concept,
  index,
}: {
  concept: StoryConcept;
  index: number;
}) {
  const ui = useUI();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Link
      className="poster concept-poster"
      href={`/concepts?concept=${concept.slug}`}
      aria-label={ui(`查看原创故事概念：${ui(concept.title)}`)}
      data-ready={ready}
      style={{ "--poster-delay": `${(index % 5) * 75}ms` } as CSSProperties}
    >
      <Image
        className="poster-image"
        src={conceptImage(concept.slug)}
        alt={ui(concept.alt)}
        width={1024}
        height={1536}
        sizes="(max-width: 640px) 140px, (max-width: 1200px) 18vw, 220px"
        loading={index < 5 ? "eager" : "lazy"}
        onLoad={() => setReady(true)}
        onError={() => {
          setFailed(true);
          setReady(true);
        }}
      />
      {failed && <span className="concept-image-error">{ui("封面暂时无法加载")}</span>}
      <span className="concept-genre">{ui(concept.genre)}</span>
      <span className="concept-caption">

        <strong>{ui(concept.title)}</strong>
        <small>{ui("Plotloom · 原创视觉概念")}</small>
      </span>
      <span className="poster-overlay">
        <span>
          {ui(" 探索故事 ")}<ArrowRight size={15} />
        </span>
      </span>
    </Link>
  );
}
