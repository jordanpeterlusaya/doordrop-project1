import { Image, type ImageSourcePropType } from 'react-native';

export const images = {
  toyoMedium: require('@/assets/images/toyo-medium.png'),
  kirikuu: require('@/assets/images/10.png'),
  cargoAvatarToyo: require('@/assets/images/cargo-avatar-toyo.png'),
  cargoAvatarToyoElectric: require('@/assets/images/cargo-avatar-toyo-electric-cut.png'),
  cargoAvatarKirikuu: require('@/assets/images/cargo-avatar-kirikuu.png'),
  cargoAvatarCanter: require('@/assets/images/cargo-avatar-canter.png'),
  cargoSideToyo: require('@/assets/images/cargo-side-toyo-body.png'),
  cargoSideKirikuu: require('@/assets/images/cargo-side-kirikuu-body.png'),
  cargoSideCanter: require('@/assets/images/cargo-side-canter-body.png'),
  cargoSideTire: require('@/assets/images/cargo-side-tire.png'),
  bodaboda: require('@/assets/images/bodaboda-marker.png'),
  bajaji: require('@/assets/images/bajajiui.png'),
  parcelExpressPlane: require('@/assets/images/parcel-express-plane.png'),
  parcelExpressFastBadge: require('@/assets/images/parcel-express-fast-badge.png'),
  parcelRoadBus: require('@/assets/images/parcel-road-bus.png'),
  parcelHubAirport: require('@/assets/images/parcel-hub-airport.png'),
  parcelHomeDelivery: require('@/assets/images/parcel-home-delivery.png'),
  parcelWeightBox: require('@/assets/images/parcel-weight-box.png'),
  parcelPackingBox: require('@/assets/images/parcel-packing-box.png'),
  parcelRecipientPerson: require('@/assets/images/parcel-recipient-person.png'),
  expressUnavailableAvatar: require('@/assets/images/express-unavailable-avatar.png'),
  offlineSadAvatar: require('@/assets/images/offline-sad-avatar.png'),
  offlineSatelliteAvatar: require('@/assets/images/offline-satellite-avatar.png'),
  cargoOutOfReachAvatar: require('@/assets/images/cargo-out-of-reach-avatar.png'),
  outsideParcelOutOfReachAvatar: require('@/assets/images/outside-parcel-out-of-reach-avatar.png'),
  homeTileParcel: require('@/assets/images/home-tile-parcel.png'),
  homeTileCargo: require('@/assets/images/home-tile-cargo.png'),
  homeAvatarMizigo: require('@/assets/images/home-avatar-mizigo.png'),
  homeTileParcelSoft: require('@/assets/images/home-tile-parcel-soft.png'),
  homeTileTiketiSoft: require('@/assets/images/home-tile-tiketi-soft.png'),
  homeTileNinunulieSoft: require('@/assets/images/home-tile-ninunulie-soft.png'),
  homePromoNinunulie: require('@/assets/images/home-promo-ninunulie.png'),
  homePromoTiketi: require('@/assets/images/home-promo-tiketi.png'),
  homePromoParcel: require('@/assets/images/home-promo-parcel.png'),
};

const HOME_PRELOAD_SOURCES: ImageSourcePropType[] = [
  images.homeAvatarMizigo,
  images.homeTileParcelSoft,
  images.homeTileTiketiSoft,
  images.homeTileNinunulieSoft,
  images.homePromoNinunulie,
  images.homePromoTiketi,
  images.homePromoParcel,
];

let homeImagesPreloaded = false;

export function preloadHomeImages() {
  if (homeImagesPreloaded) {
    return;
  }
  homeImagesPreloaded = true;

  for (const source of HOME_PRELOAD_SOURCES) {
    const resolved = Image.resolveAssetSource(source);
    if (resolved?.uri) {
      void Image.prefetch(resolved.uri);
    }
  }
}
