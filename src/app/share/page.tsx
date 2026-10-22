import type { Metadata } from "next";
import { SharedMeetingViewer } from "@/components/shared-meeting-viewer";

export const metadata: Metadata = {
  title: "Shared meeting minutes | MinuteMate",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharedMeetingPage() {
  return <SharedMeetingViewer />;
}
