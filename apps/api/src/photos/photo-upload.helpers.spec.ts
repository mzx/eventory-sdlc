import { ArgumentsHost, PayloadTooLargeException } from '@nestjs/common';
import { PayloadTooLargeFilter } from './photo-upload.helpers';

// ---------------------------------------------------------------------------
// PayloadTooLargeFilter — EVT-17 review round 2, finding 4
//
// The filter's message is constructor-configurable so each route can report
// its own actual upload ceiling instead of a hardcoded "20 MB" (accurate for
// `POST /api/photos/upload`, wrong for the 5 MB `search-by-photo` route).
// ---------------------------------------------------------------------------

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('PayloadTooLargeFilter', () => {
  it('defaults to the 20 MB message when constructed with no argument', () => {
    const filter = new PayloadTooLargeFilter();
    const { host, status, json } = makeHost();

    filter.catch(new PayloadTooLargeException(), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'File exceeds the 20 MB upload limit' }),
    );
  });

  it('reports a route-specific message when constructed with one (search-by-photo, 5 MB)', () => {
    const filter = new PayloadTooLargeFilter('File exceeds the 5 MB search-by-photo upload limit');
    const { host, status, json } = makeHost();

    filter.catch(new PayloadTooLargeException(), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'File exceeds the 5 MB search-by-photo upload limit' }),
    );
  });
});
