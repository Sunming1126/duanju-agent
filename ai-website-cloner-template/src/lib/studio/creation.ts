import { backendRequest, jsonBody, type Work, type WorkInput } from "./api";
import type { CreationIntent } from "./workflow";

/** Save every stage before requesting generation. A job failure never repeats creation. */
export async function createWorkForStep(payload: WorkInput, intent: CreationIntent, onSaved: (work: Work) => void) {
  if (intent.generate && !intent.all && intent.step === "settings") throw new Error("请先保存作品，再完善作品世界。");
  const work = await backendRequest<Work>("/studio/works", { method: "POST", body: jsonBody(payload) });
  onSaved(work);
  let warning = "";
  if (intent.generate) {
    try {
      await backendRequest(`/studio/works/${work.id}/jobs`, { method: "POST", body: jsonBody({
        revision: work.revision, action: intent.all ? "premise" : intent.step, number: !intent.all && intent.step === "chapter" ? intent.number : 1,
        mode: intent.all ? "all" : "single",
        request_key: `create-${work.id}-${intent.all ? "all" : `${intent.step}-${intent.number}`}`,
      }) });
    } catch {
      warning = "草稿及全部输入已保存，生成请求暂未确认。可在当前步骤查看进度或重新打开作品核对。";
    }
  }
  return { work, warning };
}
