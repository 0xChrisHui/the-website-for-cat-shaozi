import "server-only";

// 存放管理员边界。应用与工作器只使用受限 SQL 连接。
export function adminUnavailable(): never {
  throw new Error("Use the maintainer's trusted migration workflow");
}
