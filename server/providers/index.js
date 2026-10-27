import steam from './steam.js';
import cheapshark from './cheapshark.js';
import itad from './itad.js';
import googlebooks from './googlebooks.js';
import { appStore, appleBooks, appleAudiobooks, itunesMovies, itunesMusic } from './itunes.js';
import { createAiWebProvider } from './aiweb.js';

export const aiWeb = createAiWebProvider();

// 새 스토어를 붙이려면 { id, name, categories, search(query, ctx) } 형태의 모듈을 만들어 여기에 추가하면 된다.
// aiWeb은 분류와 상관없이 모든 검색에 참여한다(categories: ['*']).
export const allProviders = [steam, cheapshark, itad, appStore, appleBooks, googlebooks, appleAudiobooks, itunesMovies, itunesMusic, aiWeb];

export const CATEGORIES = [
  { id: 'game', label: '게임' },
  { id: 'app', label: '앱' },
  { id: 'ebook', label: '전자책' },
  { id: 'audiobook', label: '오디오북' },
  { id: 'movie', label: '영화' },
  { id: 'music', label: '음악' },
  { id: 'subscription', label: '구독' },
  { id: 'software', label: '소프트웨어' },
  { id: 'giftcard', label: '기프트카드' },
];

export function isEnabled(provider, env) {
  return !provider.requiredEnv || Boolean(env[provider.requiredEnv]);
}
