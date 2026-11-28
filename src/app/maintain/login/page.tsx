import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diagnosticsEnabled } from "@/lib/env";
import { login, sampleLogin } from "./actions";
import { LoginSubmit } from "./submit";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  const { failed } = await searchParams;
  return <section className="review-workspace space-y-5 py-6">
    <h1 className="font-heading text-2xl">维护者登录</h1>
    {failed && <p role="alert">登录失败，请检查账号和密码。</p>}
    <form action={login} className="grid max-w-sm gap-3">
      <label htmlFor="email">邮箱</label><Input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="password">密码</label><Input id="password" name="password" type="password" autoComplete="current-password" required />
      <LoginSubmit />
    </form>
    {diagnosticsEnabled() && <form action={sampleLogin}><Button type="submit">样本登录</Button></form>}
  </section>;
}
