import type { CompanyFeatures } from "@rakazo/contracts";
import { defaultComposerEnterToSend, setComposerEnterToSend } from "./composer-enter-to-send-pref";
import { setRemoteImagesPreference } from "./remote-images-preference";
import { setResponseStreamingPreference } from "./response-streaming";
import { setToolActivityPreference } from "./tool-activity-preference";

type CompanyChatSettings = Pick<
  CompanyFeatures,
  "sendWithEnter" | "streamReplies" | "toolActivity" | "webImages"
>;

/** Chat behaviour is set by the company admin; this replaces anything saved on the device. */
export function applyCompanyChatSettings(
  settings: Partial<CompanyChatSettings> | undefined,
  coarsePointer?: boolean,
) {
  if (!settings) return;
  if (settings.sendWithEnter !== undefined) {
    setComposerEnterToSend(settings.sendWithEnter && defaultComposerEnterToSend(coarsePointer));
  }
  if (settings.streamReplies !== undefined) {
    setResponseStreamingPreference(settings.streamReplies ? "on" : "off");
  }
  if (settings.toolActivity !== undefined) {
    setToolActivityPreference(settings.toolActivity ? "on" : "off");
  }
  if (settings.webImages !== undefined) {
    setRemoteImagesPreference(settings.webImages ? "on" : "off");
  }
}
