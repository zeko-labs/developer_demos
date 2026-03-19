import type { ReactNode } from 'react';

export function SectionCard(props: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 24,
        padding: 22,
        marginBottom: 18,
        background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04))',
        boxShadow: '0 24px 60px rgba(5, 14, 24, 0.18)',
        backdropFilter: 'blur(18px)'
      }}
    >
      <h3
        style={{
          marginTop: 0,
          marginBottom: 14,
          fontSize: '0.84rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(242, 246, 252, 0.78)'
        }}
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}
