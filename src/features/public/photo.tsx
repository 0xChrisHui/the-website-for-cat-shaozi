"use client";

import Image from "next/image";
import { useState } from "react";

export function PublicPhoto({ src, alt, cover = false }: { src: string; alt: string; cover?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [preserveFrame, setPreserveFrame] = useState(false);

  return (
    <div className={cover ? "photo-frame photo-frame-cover" : "photo-frame"}>
      {failed ? (
        <p role="status" className="p-4 text-center">照片暂时无法显示</p>
      ) : (
        <Image
          src={src}
          alt={alt}
          width={960}
          height={720}
          unoptimized
          loading={cover ? "eager" : "lazy"}
          fetchPriority={cover ? "high" : undefined}
          className={cover && !preserveFrame ? "object-cover" : "object-contain"}
          onError={() => setFailed(true)}
          onLoad={cover ? ({ currentTarget }) => {
            const ratio = currentTarget.naturalWidth / currentTarget.naturalHeight;
            setPreserveFrame(ratio < 1.5 || ratio > 1.9);
          } : undefined}
        />
      )}
    </div>
  );
}
