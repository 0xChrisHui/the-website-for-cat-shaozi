import { PublicPhoto } from "./photo";
import { samplePhotos } from "./sample-content";

export function SamplePhoto({ photo, eager = false }: { photo: keyof typeof samplePhotos; eager?: boolean }) {
  return <PublicPhoto alt={samplePhotos[photo].alt} src={`/timeline/sample-photo/${photo}`} cover={eager} />;
}
