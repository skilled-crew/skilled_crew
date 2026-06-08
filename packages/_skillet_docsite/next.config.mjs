import nextra from 'nextra';

const withNextra = nextra({});

export default withNextra({
	output: 'export',
	basePath: process.env.NODE_ENV === 'production' ? '/skilled_crew' : '',
	images: { unoptimized: true },
	trailingSlash: true,
});
