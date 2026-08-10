import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Button,
  Heading,
  Hr,
  Section,
  Tailwind,
} from '@react-email/components';

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
  incidentUrl = 'http://localhost:3000/dashboard/incidents',
}: IncidentUpdateEmailProps) {
  const statusColor = STATUS_COLORS[status] ?? 'text-purple-600';

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-purple-50 font-sans my-0 py-10">
          <Container className="mx-auto my-0 p-8 bg-white rounded-2xl border border-solid border-purple-100 max-w-[480px] shadow-sm">
            <Section className="text-center mb-6">
              <div className="inline-block w-10 h-10 bg-purple-600 rounded-xl text-white font-bold text-xl leading-10 text-center">
                N
              </div>
              <Text className="text-lg font-bold text-purple-950 mt-2 mb-0">
                Next<span className="text-purple-600">Temp</span>
              </Text>
            </Section>

            <Text className={`text-xs font-bold uppercase tracking-wide text-center mb-2 ${statusColor}`}>
              {status}
            </Text>

            <Heading className="text-purple-950 text-2xl font-extrabold text-center mb-1 mt-0">
              {incidentTitle}
            </Heading>

            {monitorName && (
              <Text className="text-purple-400 text-xs text-center mb-4 mt-0">
                Affected: {monitorName}
              </Text>
            )}

            <Text className="text-purple-800 text-base leading-relaxed mb-6 whitespace-pre-line">
              {message}
            </Text>

            <Section className="text-center mb-7">
              <Button
                href={incidentUrl}
                className="bg-purple-600 text-white px-7 py-3 rounded-xl font-semibold text-sm no-underline inline-block shadow-md shadow-purple-600/20"
              >
                View Incident &rarr;
              </Button>
            </Section>

            <Hr className="border-solid border-purple-100 my-6" />

            <Text className="text-purple-400 text-xs text-center my-0">
              You're receiving this because you subscribed to updates on this incident.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
