'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Layers3, Database, Lock, CheckCircle2, Zap, Palette, ArrowRight, Package, FileText, Mail } from 'lucide-react';

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
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1, // Animate children one by one
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
    <div className="min-h-screen bg-purple-50 text-purple-950 selection:bg-purple-200">
      <main className="max-w-7xl mx-auto px-6 py-20 md:py-32">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="text-center mb-24"
        >
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter text-purple-950 mb-6 leading-tight">
            Next<span className="text-purple-600">Temp</span>
          </h1>

          <p className="text-xl md:text-2xl text-purple-800/90 max-w-2xl mx-auto font-medium mb-12 leading-relaxed">
            A NextJS template made the way <span className="italic text-purple-700">I like it</span>. Fast, typesafe and ready for prod.
          </p>
        </motion.div>

        <section>
          <div className="mb-12 flex items-center gap-4">
            <h2 className="text-3xl font-bold tracking-tight text-purple-900">My favorite stack</h2>
            <div className="flex-grow h-px bg-purple-100"></div>
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
                  className={`relative group bg-white p-6 rounded-2xl border border-purple-100 shadow-sm transition-all hover:shadow-lg hover:shadow-purple-500/5 hover:border-purple-200`}
                >
                  <div className="flex items-start gap-5">
                    <div className={`p-3 rounded-xl`}>
                      <Icon className="w-7 h-7" strokeWidth={1.5} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-purple-950 mb-1 flex items-center gap-2">
                        {item.name}
                        {/*{item.optional && (*/}
                        {/*  <span className="text-xs font-medium text-purple-400 bg-purple-50 px-2 py-0.5 rounded">Optional</span>*/}
                        {/*)}*/}
                      </h3>
                      <p className="text-purple-800/80 text-sm font-medium leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 absolute bottom-4 right-4 text-purple-300 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </motion.div>
              );
            })}
          </motion.div>
        </section>
      </main>
    </div>
  );
}
