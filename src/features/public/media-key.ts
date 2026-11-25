export const sampleSource = "memorial-review-sample";
export const sampleDisplayKey = "memorial-sample/approved-photo";

export function sampleEvent(runId: string) {
  return sampleSource + ":" + runId;
}

export function displayKey(itemId: string, versionId: string) {
  return `memorial/display/${itemId}/${versionId}`;
}
