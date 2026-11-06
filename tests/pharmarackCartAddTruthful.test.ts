import { isPharmarackCartSuccess } from '../src/routes/pharmarack.js';

describe('Pharmarack Cart Add Truthful Success Recognition', () => {
  test('recognizes Indian pharma ASP.NET StatusCode 1 as success', () => {
    expect(isPharmarackCartSuccess({ StatusCode: 1, Message: 'Product Added in Cart' })).toBe(true);
    expect(isPharmarackCartSuccess({ statusCode: 1, message: 'Item added to cart' })).toBe(true);
    expect(isPharmarackCartSuccess({ StatusCode: '1', Message: 'Done' })).toBe(true);
  });

  test('recognizes PascalCase Status "Success" without lowercase match', () => {
    expect(isPharmarackCartSuccess({ Status: 'Success', Message: 'Product detail updated' })).toBe(true);
    expect(isPharmarackCartSuccess({ Status: true, Message: 'OK' })).toBe(true);
    expect(isPharmarackCartSuccess({ status: 'success' })).toBe(true);
    expect(isPharmarackCartSuccess({ status: 'OK' })).toBe(true);
  });

  test('recognizes descriptive cart addition messages without the word "success"', () => {
    expect(isPharmarackCartSuccess({ StatusCode: 0, Message: 'Product Added in Cart' })).toBe(true);
    expect(isPharmarackCartSuccess({ Code: 0, message: 'Item added into cart successfully' })).toBe(true);
    expect(isPharmarackCartSuccess({ Message: 'Product already exists in cart' })).toBe(true);
    expect(isPharmarackCartSuccess({ message: 'item in cart' })).toBe(true);
  });

  test('correctly rejects genuine distributor failure messages', () => {
    expect(isPharmarackCartSuccess({ StatusCode: 0, Message: 'Distributor minimum order value is Rs 1000' })).toBe(false);
    expect(isPharmarackCartSuccess({ StatusCode: 0, Message: 'Product is out of stock' })).toBe(false);
    expect(isPharmarackCartSuccess({ StatusCode: 0, Message: 'Invalid store credentials' })).toBe(false);
    expect(isPharmarackCartSuccess(null)).toBe(false);
    expect(isPharmarackCartSuccess({})).toBe(false);
  });
});

