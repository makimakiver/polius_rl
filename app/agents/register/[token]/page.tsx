import RegisterAgentFlow from "../RegisterAgentFlow";

export default async function RegisterAgentTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <RegisterAgentFlow initialToken={decodeURIComponent(token)} />;
}
