import intake from "../../e2e/acceptance/delivered/intake.json" with { type: "json" };
import memorial from "../../e2e/acceptance/delivered/memorial.json" with { type: "json" };
import permanent from "../../e2e/acceptance/delivered/permanent.json" with { type: "json" };
import exportsFlag from "../../e2e/acceptance/delivered/exports.json" with { type: "json" };

export const maintainNavigation = [
  { name: "投稿待办", path: "/maintain/intake", flag: intake },
  { name: "审核投稿", path: "/maintain/review", flag: memorial },
  { name: "日记历史", path: "/maintain/review/diaries", flag: memorial },
  { name: "处理设置", path: "/maintain/settings/processing", flag: memorial },
  { name: "纪念日设置", path: "/maintain/settings/anniversary", flag: memorial },
  { name: "永久任务", path: "/maintain/permanent", flag: permanent },
  { name: "离线快照", path: "/maintain/exports", flag: exportsFlag },
] as const;
