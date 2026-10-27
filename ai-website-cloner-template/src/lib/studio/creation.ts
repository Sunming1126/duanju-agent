import { backendRequest, jsonBody, type Work, type WorkInput } from "./api";
import type { CreationIntent } from "./workflow";

/** Save every stage before requesting generation. A job failure never repeats creation. */
export async function createWorkForStep(payload: WorkInput, intent: CreationIntent, onSaved: (work: Work) => void) {
  const work = await backendRequest<Work>("/studio/works", { method: "POST", body: jsonBody(payload) });
  onSaved(work);
  let warning = "";
  if (intent.generate) {
    try {
      await backendRequest(`/studio/works/${work.id}/jobs`, { method: "POST", body: jsonBody({
        revision: work.revision, action: intent.step, number: intent.step === "chapter" ? intent.number : 1,
        request_key: `create-${work.id}-${intent.step}-${intent.number}`,
      }) });
    } catch {
      warning = "草稿及全部输入已保存，生成请求尚未确认成功。请先查看任务列表，再决定是否手动生成。";
    }
  }
  return { work, warning };
}
