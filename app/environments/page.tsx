import { redirect } from "next/navigation";

// Environments merged into the unified marketplace.
export default function EnvironmentsRedirect() {
  redirect("/market");
}
