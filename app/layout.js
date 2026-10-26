import './globals.css';

export const metadata = {
  title: 'Hisaab - smart khata for kirana stores',
  description: 'Billing, udhaar ledger and inventory with semantic search',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
