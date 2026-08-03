export const metadata = {
  title: 'FarmAds.ng',
  description: 'AI-Powered Agricultural Marketplace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

