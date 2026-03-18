import type { ReactNode } from 'react';

export function SectionCard(props: { title: string; children: ReactNode }) {
  return (
    <section style={{ border: '1px solid #d0d7de', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>{props.title}</h3>
      {props.children}
    </section>
  );
}
