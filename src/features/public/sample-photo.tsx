import Image from "next/image";
import { samplePhotos } from "./sample-content";

export function SamplePhoto({ photo, eager = false }: { photo: keyof typeof samplePhotos; eager?: boolean }) {
  const { alt, width, height } = samplePhotos[photo];
  return (
    <Image
      alt={alt}
      width={width}
      height={height}
      src={`/timeline/sample-photo/${photo}`}
      unoptimized
      loading={eager ? "eager" : "lazy"}
      className={eager ? "h-auto w-full" : "aspect-4/3 w-full object-cover"}
    />
  );
}
