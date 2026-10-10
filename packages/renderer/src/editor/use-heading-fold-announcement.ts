import { useEffect, useState } from 'react';
import { HEADING_FOLDS_EXPANDED_EVENT, type HeadingFoldsExpandedDetail } from './expand-all';
import { tCurrent } from '@nexnote/shared';

export interface HeadingFoldAnnouncement {
  key: number;
  message: string;
}

/** Listen only for one tab and replace the live-region node so repeated identical feedback is announced. */
export function useHeadingFoldAnnouncement(tabId: string): HeadingFoldAnnouncement {
  const [announcement, setAnnouncement] = useState<HeadingFoldAnnouncement>({
    key: 0,
    message: '',
  });

  useEffect(() => {
    const announce = (event: Event): void => {
      const detail = (event as CustomEvent<HeadingFoldsExpandedDetail>).detail;
      if (detail.tabId !== tabId) return;
      setAnnouncement((current) => ({
        key: current.key + 1,
        message:
          detail.count > 0
            ? tCurrent('heading.foldsExpanded', { count: detail.count })
            : tCurrent('heading.noFoldedHeadings'),
      }));
    };
    window.addEventListener(HEADING_FOLDS_EXPANDED_EVENT, announce);
    return () => window.removeEventListener(HEADING_FOLDS_EXPANDED_EVENT, announce);
  }, [tabId]);

  return announcement;
}
