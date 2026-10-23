import {
  backendRequest,
  jsonBody,
  workPayload,
  type Action,
  type Work,
} from "./api";

/** Save the exact edited revision before requesting generation; never retry a mutation. */
export async function generateWorkCandidate(
  work: Work,
  options: {
    action: Action;
    number: number;
    dirty: boolean;
    onSaved: (saved: Work) => void;
  },
): Promise<{ id: string; status: string }> {
  if (!work.premise.trim())
    throw new Error("请先填写故事想法，再点击 AI 生成。");
  let saved = work;
  if (options.dirty) {
    saved = await backendRequest<Work>(`/studio/works/${work.id}`, {
      method: "PUT",
      body: jsonBody({ ...workPayload(work), revision: work.revision }),
    });
    options.onSaved(saved);
  }
  return backendRequest(`/studio/works/${saved.id}/generate`, {
    method: "POST",
    body: jsonBody({
      action: options.action,
      number: options.number,
      revision: saved.revision,
    }),
  });
}
