import assert from 'node:assert/strict';
import { factCheckClaim } from '../lib/factCheck.ts';

const falseClaim = 'The Great Wall of China is visible from the Moon with the naked eye.';
const platypusClaim =
  "Platypuses are highly unusual mammals-they don't have stomachs, and they sweat milk to feed their young rather than having nipples.";

const mockFetch = async (url, init) => {
  assert.equal(url, 'https://api.tavily.com/search');
  assert.equal(init.headers.Authorization, 'Bearer test-tavily-key');
  assert.equal(JSON.parse(init.body).api_key, undefined);
  const query = JSON.parse(init.body).query;

  if (query.includes('Platypuses')) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          answer:
            'Platypuses do not have a conventional stomach, and female platypuses do not have nipples. They secrete milk from mammary glands through skin, where it collects in grooves and fur for young to lap up.',
          results: [
            {
              title: 'The Platypus is Missing This Major Organ',
              url: 'https://example.com/platypus-stomach',
              content:
                'Platypuses are monotremes that lack a conventional stomach. Their digestive tract connects the esophagus directly to the intestines.',
            },
            {
              title: 'Platypus milk: How it could combat superbugs',
              url: 'https://example.com/platypus-milk',
              content:
                'Female platypuses do not have nipples. Instead, milk is secreted through mammary gland ducts onto the skin and collects in grooves for the young to drink. So, how does the milk thing work with no nipples?',
            },
          ],
        };
      },
    };
  }

  return {
    ok: true,
    status: 200,
    async json() {
      return {
        results: [
          {
            title: 'NASA - The Great Wall from Space',
            url: 'https://www.nasa.gov/vision/space/workinginspace/great_wall.html',
            content:
              'The claim that the Great Wall of China is visible from the Moon is a myth and is not true to the unaided eye.',
          },
          {
            title: 'Encyclopaedia Britannica - Can You See the Great Wall from Space?',
            url: 'https://www.britannica.com/story/can-you-see-the-great-wall-of-china-from-space',
            content:
              'Britannica explains that the Great Wall is not visible from the Moon without aid, correcting the common false claim.',
          },
        ],
      };
    },
  };
};

const result = await factCheckClaim(falseClaim, {
  fetch: mockFetch,
  tavilyApiKey: 'test-tavily-key',
  openAiApiKey: '',
  openAiModel: '',
});

assert.equal(result.status, 'False');
assert.ok(result.sources.some((source) => source.url.includes('nasa.gov')));
assert.ok(result.summary.length > 0);
assert.ok(result.summary.length <= 700);
assert.match(result.summary, /visible from the Moon|myth|not true/i);
assert.match(result.summary, /claim is false|contradicts/i);
assert.equal(result.sources.some((source) => 'snippet' in source), false);

const platypusResult = await factCheckClaim(platypusClaim, {
  fetch: mockFetch,
  tavilyApiKey: 'test-tavily-key',
  openAiApiKey: '',
  openAiModel: '',
});

assert.equal(platypusResult.status, 'Disputed');
assert.match(platypusResult.summary, /stomach|nipples|mammary glands|skin/i);
assert.doesNotMatch(platypusResult.summary, /\?/);
assert.doesNotMatch(platypusResult.summary, /So, how/i);
assert.equal(platypusResult.sources.some((source) => 'snippet' in source), false);

const rateLimitedResult = await factCheckClaim(falseClaim, {
  fetch: async (url, init) => {
    if (url === 'https://api.openai.com/v1/responses') {
      assert.equal(init.headers.Authorization, 'Bearer test-openai-key');
      return {
        ok: false,
        status: 429,
        async json() {
          return {};
        },
      };
    }

    return mockFetch(url, init);
  },
  tavilyApiKey: 'test-tavily-key',
  openAiApiKey: 'test-openai-key',
  openAiModel: 'gpt-test',
});

assert.equal(rateLimitedResult.status, 'False');
assert.ok(rateLimitedResult.sources.some((source) => source.url.includes('nasa.gov')));

console.log(JSON.stringify(result, null, 2));
