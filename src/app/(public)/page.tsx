
'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Layers3,
  Database,
  Lock,
  CheckCircle2,
  Zap,
  Palette,
  Package,
  FileText,
  Mail,
  ExternalLink,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { redirect } from 'next/navigation';

const stackItems = [
  { name: 'Next.js 16', description: 'App Router, Server Actions & modern React', icon: Zap },
  { name: 'Prisma', description: 'Type-safe ORM with SQLite and Postgres support', icon: Database },
  { name: 'Redis', description: 'High-performance in-memory caching & session store', icon: Database },
  { name: 'BetterAuth', description: 'Modern, multi-provider authentication framework', icon: Lock },
  { name: 'Nodemailer', description: 'Transactional email delivery with React Email templates', icon: Mail },
  { name: 'Winston', description: 'Structured console & file-based application logging', icon: FileText },
  { name: 'Zod', description: 'TypeScript-first schema validation & runtime type checks', icon: CheckCircle2 },
  { name: 'Lucide React', description: 'Clean, consistent & customizable icon library', icon: Layers3 },
  { name: 'Framer Motion', description: 'Smooth, production-ready React animations', icon: Palette },
  { name: 'Docker', description: 'Production-ready containerization setup', icon: Package },
  { name: 'Shadcn UI', description: 'Ready to-go UI components', icon: Package },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 100,
      damping: 15,
    },
  },
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <main className="max-w-7xl mx-auto px-6 py-20 md:py-32">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="text-center mb-24"
        >
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter text-foreground mb-6 leading-tight">
            Next<span className="text-primary">Temp</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto font-medium mb-8 leading-relaxed">
            A NextJS template made the way <span className="italic text-foreground">I like it</span>. Fast, typesafe and ready for prod.
          </p>

          <Button size="lg" className="font-semibold shadow-md">
            <a
              href="https://gitlab.com/heapreaper/nexttemp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2"
            >
              <span>Get Started</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          </Button>
        </motion.div>

        <section>
          <div className="mb-12 flex items-center gap-4">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">My favorite stack</h2>
            <div className="flex-grow h-px bg-border"></div>
          </div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {stackItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={index}
                  variants={itemVariants}
                  whileHover={{ y: -5, transition: { duration: 0.2 } }}
                >
                  <Card className="relative group h-full transition-all hover:shadow-md hover:border-primary/50">
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-4">
                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                          <Icon className="w-6 h-6" strokeWidth={1.5} />
                        </div>
                        <div>
                          <CardTitle className="text-lg font-semibold flex items-center gap-2">
                            {item.name}
                          </CardTitle>
                          <CardDescription className="text-sm leading-relaxed mt-1.5">
                            {item.description}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </section>
      </main>
    </div>
  );
}