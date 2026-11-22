import { flush, updateBadge } from "./shared.js";

// Send queued grants when the browser starts, and every minute until the app answers.
chrome.runtime.onStartup.addListener(() => void flush());
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("flush", { periodInMinutes: 1 });
  void updateBadge();
});
chrome.alarms.onAlarm.addListener((a) => a.name === "flush" && void flush());
