import { expect, test } from "../../support/fixture";
import { withExtractedFixture } from "../../../src/features/exports/offline-fixture";

test("opens the extracted diary and photo without a network", async ({ page }) => {
  await withExtractedFixture(async (html, media) => {
    await page.context().setOffline(true);
    await page.setContent(html);
    await expect(page.getByText("离线日记 <script>合成文字</script>", { exact: true })).toBeVisible();
    const photo = page.getByRole("img", { name: "合成图注" });
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute("src", "media/1.webp");
    await photo.evaluate((element, source) => element.setAttribute("src", source), media);
    await expect.poll(() => photo.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(32);
  });
});
