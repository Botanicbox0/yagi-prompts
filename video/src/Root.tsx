import { Composition } from 'remotion';
import { EndingCard, endingCardSchema } from './EndingCard';
import { LongCard, longCardSchema } from './LongCard';

export const FPS = 30;
export const DURATION = 90; // 3.0 s
export const LONG_DURATION = 300; // 10.0 s

const defaultProps = { transparent: false, reveal: 'draw' as const };

export const Root = () => (
  <>
    <Composition
      id="EndingCard"
      component={EndingCard}
      schema={endingCardSchema}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={defaultProps}
    />
    <Composition
      id="EndingCardVertical"
      component={EndingCard}
      schema={endingCardSchema}
      durationInFrames={DURATION}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
    />
    <Composition
      id="EndingCardLong"
      component={LongCard}
      schema={longCardSchema}
      durationInFrames={LONG_DURATION}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ transparent: false }}
    />
    <Composition
      id="EndingCardLongVertical"
      component={LongCard}
      schema={longCardSchema}
      durationInFrames={LONG_DURATION}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ transparent: false }}
    />
  </>
);
