import { catalogImageService } from '../src/services/catalogImageService.ts';

async function test() {
  const res = await catalogImageService.getImages({ search: 'DYTOR 20', page: 1, limit: 10 });
  console.log('Results:', res);
}
test();
