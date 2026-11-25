import { productionProblems } from '../src/config/environment';

const good: any = { FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'a@b.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'k', ML_INTERNAL_KEY: 'x'.repeat(32), FRONTEND_URL: 'https://app.example.com' };

describe('production configuration guard', () => {
  it('accepts a complete configuration', () => { expect(productionProblems(good)).toEqual([]); });
  it('requires Firebase credentials', () => {
    expect(productionProblems({ ...good, FIREBASE_PRIVATE_KEY: '' }).join()).toMatch(/FIREBASE/);
  });
  it('rejects the placeholder and short ML keys', () => {
    expect(productionProblems({ ...good, ML_INTERNAL_KEY: 'change-me' }).join()).toMatch(/ML_INTERNAL_KEY/);
    expect(productionProblems({ ...good, ML_INTERNAL_KEY: '' }).join()).toMatch(/ML_INTERNAL_KEY/);
    expect(productionProblems({ ...good, ML_INTERNAL_KEY: 'short' }).join()).toMatch(/ML_INTERNAL_KEY/);
    expect(productionProblems({ ...good, ML_INTERNAL_KEY: 'CHANGEME-CHANGEME-CHANGEME' }).join()).toMatch(/ML_INTERNAL_KEY/);
  });
  it('requires an https frontend origin (localhost allowed for local production runs)', () => {
    expect(productionProblems({ ...good, FRONTEND_URL: 'http://app.example.com' }).join()).toMatch(/FRONTEND_URL/);
    expect(productionProblems({ ...good, FRONTEND_URL: 'http://localhost:3000' })).toEqual([]);
  });
  it('reports every problem at once', () => { expect(productionProblems({ ...good, FIREBASE_PROJECT_ID: '', ML_INTERNAL_KEY: 'x', FRONTEND_URL: 'ftp://x' })).toHaveLength(3); });
});
