import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const HAUL = '#FFE500';
const INK = '#111827';
const SCENE_W = 300;
const SCENE_H = 168;
const CITY_W = 520;
const LOOP_MS = 16000;
const GAIT_MS = 340;

const STORY = [0, 0.16, 0.28, 0.46, 0.58, 0.68, 0.82, 0.92, 1];
const ROAD_X = [0, -140, -250, -300, -312, -330, -470, -508, -520];
const TURNS = [0, 1.6, 3.1, 3.7, 3.78, 3.86, 6.4, 8.1, 9];

type VehicleKind = 'toyo' | 'kirikuu' | 'canter';

const BODY: Record<VehicleKind, ImageSourcePropType> = {
  toyo: require('@/assets/images/search-cinematic/search-toyo.png'),
  kirikuu: require('@/assets/images/search-cinematic/search-kirikuu.png'),
  canter: require('@/assets/images/search-cinematic/search-canter.png'),
};

const CITY = require('@/assets/images/search-cinematic/search-city.jpg');
const WHEEL = require('@/assets/images/search-cinematic/search-wheel.png');
const RUN_A = require('@/assets/images/search-cinematic/search-runner-a.png');
const RUN_B = require('@/assets/images/search-cinematic/search-runner-b.png');
const RUN_REACH = require('@/assets/images/search-cinematic/search-runner-reach.png');

const WHEELS: Record<VehicleKind, { left: number; size: number; bottom: number }[]> = {
  toyo: [
    { left: 38, size: 22, bottom: 8 },
    { left: 124, size: 18, bottom: 10 },
  ],
  kirikuu: [
    { left: 28, size: 24, bottom: 10 },
    { left: 132, size: 24, bottom: 10 },
  ],
  canter: [
    { left: 26, size: 24, bottom: 8 },
    { left: 138, size: 24, bottom: 8 },
  ],
};

const VEHICLE_BOX: Record<VehicleKind, { width: number; height: number }> = {
  toyo: { width: 168, height: 78 },
  kirikuu: { width: 178, height: 80 },
  canter: { width: 188, height: 82 },
};

function resolveKind(vehicleKey?: string): VehicleKind {
  const key = String(vehicleKey || '').toLowerCase();
  if (key === 'kirikuu') {
    return 'kirikuu';
  }
  if (key === 'canter' || key === 'center' || key === 'fuso') {
    return 'canter';
  }
  return 'toyo';
}

function SpinWheel({
  story,
  size,
  left,
  bottom,
}: {
  story: SharedValue<number>;
  size: number;
  left: number;
  bottom: number;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-interpolate(story.value, STORY, TURNS) * 360}deg` }],
  }));

  return (
    <Animated.Image
      source={WHEEL}
      style={[
        {
          position: 'absolute',
          left,
          bottom,
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        style,
      ]}
    />
  );
}

function World({ story }: { story: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(story.value, STORY, ROAD_X) }],
  }));

  return (
    <Animated.View style={[styles.world, style]}>
      <Image source={CITY} style={styles.city} />
      <Image source={CITY} style={styles.city} />
    </Animated.View>
  );
}

function LaneDashes({ story }: { story: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(story.value, STORY, ROAD_X) % 36 }],
  }));

  return (
    <View style={styles.dashClip} pointerEvents="none">
      <Animated.View style={[styles.dashRow, style]}>
        {Array.from({ length: 22 }, (_, index) => (
          <View key={index} style={styles.dash} />
        ))}
      </Animated.View>
    </View>
  );
}

function Headlights({ story }: { story: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(story.value, [0.58, 0.64, 0.74, 0.82], [0, 1, 0.55, 0]),
  }));

  return (
    <Animated.View style={[styles.lights, style]} pointerEvents="none">
      <View style={styles.light} />
      <View style={[styles.light, styles.lightLow]} />
    </Animated.View>
  );
}

function Runner({ story, gait }: { story: SharedValue<number>; gait: SharedValue<number> }) {
  const wrap = useAnimatedStyle(() => ({
    opacity: interpolate(story.value, [0.14, 0.2, 0.56, 0.63], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(story.value, [0.16, 0.34, 0.5, 0.6], [-36, 22, 72, 104]) },
      { translateY: -Math.abs(Math.sin(gait.value * Math.PI * 2)) * 3 },
    ],
  }));
  const a = useAnimatedStyle(() => ({
    opacity: story.value >= 0.5 ? 0 : gait.value < 0.5 ? 1 : 0,
  }));
  const b = useAnimatedStyle(() => ({
    opacity: story.value >= 0.5 ? 0 : gait.value >= 0.5 ? 1 : 0,
  }));
  const reach = useAnimatedStyle(() => ({
    opacity: story.value >= 0.5 && story.value < 0.63 ? 1 : 0,
  }));

  return (
    <Animated.View style={[styles.runner, wrap]}>
      <Animated.Image source={RUN_A} style={[styles.runnerImg, a]} />
      <Animated.Image source={RUN_B} style={[styles.runnerImg, styles.runnerAbs, b]} />
      <Animated.Image source={RUN_REACH} style={[styles.runnerImg, styles.runnerAbs, reach]} />
    </Animated.View>
  );
}

function Vehicle({ story, kind }: { story: SharedValue<number>; kind: VehicleKind }) {
  const box = VEHICLE_BOX[kind];
  const flip = kind !== 'toyo';
  const pos = useAnimatedStyle(() => {
    const speed = interpolate(story.value, [0, 0.38, 0.52, 0.62, 0.78, 1], [1, 1, 0.25, 0.08, 1.15, 1]);
    return {
      transform: [
        { translateX: interpolate(story.value, [0, 0.22, 0.5, 0.62, 0.78, 0.9, 0.95, 1], [108, 122, 136, 140, 188, 214, 120, 108]) },
        { translateY: Math.sin(story.value * Math.PI * 28) * (1.8 * speed) },
        { scale: interpolate(story.value, [0, 0.62, 0.78, 0.9, 0.95, 1], [1, 1, 0.72, 0.52, 0.92, 1]) },
      ],
    };
  });

  return (
    <Animated.View style={[styles.vehicle, { width: box.width, height: box.height }, pos]}>
      <View style={flip ? styles.flip : undefined}>
        <Image source={BODY[kind]} style={{ width: box.width, height: box.height }} resizeMode="contain" />
        {WHEELS[kind].map((wheel) => (
          <SpinWheel key={wheel.left} story={story} size={wheel.size} left={wheel.left} bottom={wheel.bottom} />
        ))}
      </View>
      <View style={styles.shadow} />
      <Headlights story={story} />
    </Animated.View>
  );
}

export function CargoSearchCinematic({ vehicleKey }: { vehicleKey?: string }) {
  const story = useSharedValue(0);
  const gait = useSharedValue(0);
  const kind = resolveKind(vehicleKey);

  useEffect(() => {
    story.value = 0;
    gait.value = 0;
    story.value = withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.linear }), -1, false);
    gait.value = withRepeat(withTiming(1, { duration: GAIT_MS, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(story);
      cancelAnimation(gait);
    };
  }, [gait, story]);

  const camera = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(story.value, STORY, [10, 6, -14, -20, -10, 8, 18, 12, 10]) },
      { translateY: interpolate(story.value, STORY, [6, 8, 16, 8, 4, -8, -20, -16, 6]) },
      { scale: interpolate(story.value, STORY, [0.93, 0.9, 1.12, 1.06, 1.02, 0.86, 0.7, 0.78, 0.93]) },
    ],
  }));

  const wash = useAnimatedStyle(() => ({
    opacity: interpolate(story.value, [0, 0.07, 0.86, 0.93, 1], [0.32, 0, 0, 0.42, 0.32]),
  }));

  return (
    <View style={styles.frame}>
      <LinearGradient colors={['#7EC8E3', '#F3E2A8', '#E8D48A']} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.camera, camera]}>
        <World story={story} />
        <View style={styles.roadBed} />
        <LaneDashes story={story} />
        <Vehicle story={story} kind={kind} />
      </Animated.View>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(17,24,39,0.18)', 'transparent', 'transparent', 'rgba(17,24,39,0.28)']}
        locations={[0, 0.28, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.wash, wash]} pointerEvents="none">
        <LinearGradient colors={['rgba(255,229,0,0.28)', 'rgba(255,244,180,0.5)', 'rgba(255,229,0,0.2)']} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: SCENE_W,
    height: SCENE_H,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: INK,
  },
  camera: {
    width: SCENE_W,
    height: SCENE_H,
  },
  world: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: SCENE_H,
    width: CITY_W * 2,
    flexDirection: 'row',
  },
  city: {
    width: CITY_W,
    height: SCENE_H,
  },
  roadBed: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 28,
    backgroundColor: 'rgba(28,30,34,0.72)',
  },
  dashClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    height: 3,
    overflow: 'hidden',
  },
  dashRow: {
    flexDirection: 'row',
    gap: 16,
    width: SCENE_W + 80,
  },
  dash: {
    width: 18,
    height: 3,
    borderRadius: 1,
    backgroundColor: HAUL,
    opacity: 0.85,
  },
  vehicle: {
    position: 'absolute',
    bottom: 10,
    left: 0,
  },
  flip: {
    transform: [{ scaleX: -1 }],
  },
  shadow: {
    position: 'absolute',
    left: '12%',
    right: '10%',
    bottom: 2,
    height: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(17,24,39,0.28)',
    zIndex: -1,
  },
  lights: {
    position: 'absolute',
    right: 2,
    top: '42%',
    flexDirection: 'column',
    gap: 6,
  },
  light: {
    width: 34,
    height: 10,
    borderRadius: 8,
    backgroundColor: HAUL,
    opacity: 0.9,
    shadowColor: HAUL,
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 4,
  },
  lightLow: {
    width: 26,
  },
  runner: {
    position: 'absolute',
    left: 8,
    bottom: 12,
    width: 52,
    height: 70,
  },
  runnerImg: {
    width: 52,
    height: 70,
  },
  runnerAbs: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
  },
});
