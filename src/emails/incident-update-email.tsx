import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Img,
  Button,
  Heading,
  Hr,
  Section,
  Tailwind,
} from '@react-email/components';
import { dashboardBaseUrl, incidentsUrl } from '@/lib/urls';

interface IncidentUpdateEmailProps {
  incidentTitle: string;
  status: string;
  message: string;
  monitorName?: string | null;
  incidentUrl?: string;
}

const STATUS_COLORS: Record<string, string> = {
  Investigating: 'text-rose-600',
  Identified: 'text-amber-600',
  Monitoring: 'text-blue-600',
  Resolved: 'text-emerald-600',
};

export default function IncidentUpdateEmail({
  incidentTitle,
  status,
  message,
  monitorName,
  incidentUrl = incidentsUrl(),
}: IncidentUpdateEmailProps) {
  const statusColor = STATUS_COLORS[status] ?? 'text-emerald-600';

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-slate-50 font-sans my-0 py-10">
          <Container className="mx-auto my-0 p-8 bg-white rounded-2xl border border-solid border-slate-200 max-w-[480px] shadow-sm">
            <Section className="text-center mb-6">
              <Img
                src={`${dashboardBaseUrl()}/icon-192.png`}
                width="40"
                height="40"
                alt=""
                className="inline-block rounded-xl"
              />
              <Text className="text-lg font-bold text-slate-900 mt-2 mb-0">
                Stay<span className="text-emerald-600">Up</span>
              </Text>
            </Section>

            <Text className={`text-xs font-bold uppercase tracking-wide text-center mb-2 ${statusColor}`}>
              {status}
            </Text>

            <Heading className="text-slate-900 text-2xl font-extrabold text-center mb-1 mt-0">
              {incidentTitle}
            </Heading>

            {monitorName && (
              <Text className="text-slate-400 text-xs text-center mb-4 mt-0">
                Affected: {monitorName}
              </Text>
            )}

            <Text className="text-slate-700 text-base leading-relaxed mb-6 whitespace-pre-line">
              {message}
            </Text>

            <Section className="text-center mb-7">
              <Button
                href={incidentUrl}
                className="bg-emerald-600 text-white px-7 py-3 rounded-xl font-semibold text-sm no-underline inline-block shadow-md shadow-emerald-600/20"
              >
                View Incident &rarr;
              </Button>
            </Section>

            <Hr className="border-solid border-slate-200 my-6" />

            <Text className="text-slate-400 text-xs text-center my-0">
              You're receiving this because you subscribed to updates on this incident.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
