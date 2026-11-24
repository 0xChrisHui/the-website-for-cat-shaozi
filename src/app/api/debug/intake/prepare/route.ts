import { sampleIntake } from "@/features/foundation/intake";

export function POST(request: Request) {
  return sampleIntake(request, "prepare");
}
