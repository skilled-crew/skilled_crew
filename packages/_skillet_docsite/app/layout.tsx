import type { ReactNode } from 'react';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Banner, Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import 'nextra-theme-docs/style.css';

export const metadata = {
	title: 'skillet_agent docs',
	description: 'Documentation for the skillet_agent package',
};

const navbar = (
	<Navbar
		logo={<strong>skillet_agent</strong>}
		projectLink="https://github.com/skilled-crew/skilled_crew"
	/>
);

const footer = <Footer>MIT {new Date().getFullYear()} © skillet_agent</Footer>;

export default async function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" dir="ltr" suppressHydrationWarning>
			<Head />
			<body>
				<Layout
					navbar={navbar}
					footer={footer}
					pageMap={await getPageMap()}
					docsRepositoryBase="https://github.com/skilled-crew/skilled_crew/tree/main/packages/_skillet_docsite"
				>
					{children}
				</Layout>
			</body>
		</html>
	);
}
