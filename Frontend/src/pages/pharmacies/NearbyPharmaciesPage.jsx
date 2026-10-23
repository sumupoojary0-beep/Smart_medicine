/**
 * Nearby Pharmacies Page
 *
 * Browse mode:
 *   GET /kendras/nearby
 *
 * Medicine mode:
 *   GET /kendras/medicine/{pmbi_code}/nearby
 *   Results are ranked using the backend WSM algorithm.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import PharmacySearchSummary from './sections/PharmacySearchSummary'
import InteractiveMapSection from './sections/InteractiveMapSection'
import NearbyPharmacyList from './sections/NearbyPharmacyList'
import PharmacyDetailsPanel from './sections/PharmacyDetailsPanel'
import PharmacyWorkflowTimeline from './sections/PharmacyWorkflowTimeline'
import PharmacyTips from './sections/PharmacyTips'

import HealthcareDisclaimer from '../medicine/sections/HealthcareDisclaimer'
import Divider from '../../components/ui/Divider'
import { useGeolocation } from '../../hooks/useGeolocation'

import kendraService from '../../services/kendraService'
import { ROUTES } from '../../constants/routes'


const DEFAULT_RADIUS_KM = 50

const RANKING_LABELS = {
  distance: 'Distance',
  price: 'Price',
  quantity: 'Stock',
  freshness: 'Shelf life',
}


// =====================================================
// Nearby Pharmacies Page
// =====================================================

function NearbyPharmaciesPage() {
  const [selectedId, setSelectedId] =
    useState(null)

  const [searchParams] = useSearchParams()


  // =====================================================
  // Selected medicine
  // =====================================================

  const pmbiCode =
    searchParams.get('medicine')
    || searchParams.get('pmbi_code')

  const medicine = {
    name:
      searchParams.get('name')
      ?? (
        pmbiCode
          ? `Medicine ${pmbiCode}`
          : 'All Jan Aushadhi Kendras'
      ),

    genericName:
      searchParams.get('genericName') ?? '',
  }


  // =====================================================
  // User location
  // =====================================================

  const {
    location,
    status: locationStatus,
  } = useGeolocation()


  // =====================================================
  // Load nearby or ranked Kendras
  // =====================================================

  const kendrasQuery = useQuery({
    queryKey: [
      'kendras',
      pmbiCode
        ? 'medicine-ranked'
        : 'nearby',
      pmbiCode,
      location?.lat,
      location?.lng,
      DEFAULT_RADIUS_KM,
    ],

    queryFn: async () => {
      if (pmbiCode) {
        const response =
          await kendraService.findMedicineNearby(
            pmbiCode,
            location.lat,
            location.lng,
            DEFAULT_RADIUS_KM,
            true,
          )  // no weights sent: the server ranks with this user's saved preferences

        return response.data
      }

      const response =
        await kendraService.findNearby(
          location.lat,
          location.lng,
          DEFAULT_RADIUS_KM,
        )

      return response.data
    },

    enabled: Boolean(
      location?.lat
      && location?.lng,
    ),
  })


  // Which preferences the server used for this ranking
  const firstRanked = Array.isArray(kendrasQuery.data) ? kendrasQuery.data[0] : null
  const rankingInfo = {
    source: firstRanked?.weights_source ?? 'default',
    weights: firstRanked?.weights_used ?? null,
  }


  // =====================================================
  // Convert backend data for UI components
  // =====================================================

  const pharmacies = useMemo(() => {
    const rawResults = pmbiCode
      ? (
        Array.isArray(kendrasQuery.data)
          ? kendrasQuery.data
          : []
      )
      : kendrasQuery.data?.results ?? []

    return rawResults.map(kendra => {
      /*
       * Ranked and ordinary nearby endpoints use slightly
       * different property names.
       */
      const id =
        kendra.kendra_id
        ?? kendra.id

      const name =
        kendra.kendra_name
        ?? kendra.name

      let availability = 'available'

      if (pmbiCode) {
        availability = {
          in_stock: 'available',
          low_stock: 'limited',
          out_of_stock: 'unavailable',
        }[kendra.status] ?? 'unavailable'
      }

      const distanceKm = Number(
        kendra.distance_km ?? 0,
      )

      return {
        id,
        name,
        address: kendra.address,
        latitude: kendra.latitude,
        longitude: kendra.longitude,

        distance:
          `${distanceKm.toFixed(2)} km`,

        distanceKm,

        travelTime:
          `~${Math.max(
            1,
            Math.round(distanceKm * 2),
          )} min drive`,

        phone: kendra.phone,
        hours: 'Contact for hours',
        isOpen: true,
        isJanAushadhi: true,
        availability,
        rating: kendra.rating ?? 0,
        ratingCount: 0,
        stock: kendra.stock ?? [],

        // Medicine and inventory information
        price: kendra.price ?? null,
        totalQty:
          kendra.total_qty ?? null,

        nearestExpiry:
          kendra.nearest_expiry ?? null,

        daysToExpiry:
          kendra.days_to_expiry ?? null,

        verificationStatus:
          kendra.verification_status ?? null,

        batches:
          kendra.batches ?? [],

        // WSM ranking information
        rank:
          kendra.rank ?? null,

        wsmScore:
          kendra.wsm_score ?? null,

        scoreBreakdown:
          kendra.score_breakdown ?? null,

        weightsUsed:
          kendra.weights_used ?? null,
      }
    })
  }, [
    kendrasQuery.data,
    pmbiCode,
  ])


  // =====================================================
  // Selected pharmacy
  // =====================================================

  const selectedPharmacy = useMemo(
    () =>
      pharmacies.find(
        pharmacy =>
          pharmacy.id === selectedId,
      ),
    [
      pharmacies,
      selectedId,
    ],
  )


  // =====================================================
  // Event handlers
  // =====================================================

  function handleViewDetails(id) {
    setSelectedId(id)
  }


  // =====================================================
  // Page UI
  // =====================================================

  return (
    <article
      aria-label="Nearby Pharmacies"
      className="flex flex-col gap-5"
    >
      {/* Search summary */}

      <PharmacySearchSummary
        medicine={medicine}
        pharmacyCount={pharmacies.length}
      />


      {/* How the Kendras were ranked */}

      {pmbiCode && (
        <div
          className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3"
        >
          <p className="text-sm font-semibold text-primary-800">
            {rankingInfo.source === 'saved'
              ? 'Ranked using your saved preferences'
              : 'Ranked using the default (Balanced) preferences'}
          </p>

          {rankingInfo.weights && (
            <p className="mt-1 text-xs text-primary-700">
              {Object.entries(RANKING_LABELS)
                .map(([key, label]) => `${label} ${Math.round((rankingInfo.weights[key] ?? 0) * 100)}%`)
                .join(' · ')}
            </p>
          )}

          <Link
            to={ROUTES.USER.PROFILE}
            className="mt-1 inline-block text-xs font-semibold text-primary-700 underline hover:text-primary-900"
          >
            {rankingInfo.source === 'saved' ? 'Change my preferences' : 'Set my preferences'}
          </Link>
        </div>
      )}




      {/* Fallback location warning */}

      {locationStatus === 'fallback' && (
        <div
          className="rounded-xl bg-warning-50
                     px-4 py-2.5 text-xs
                     text-warning-700"
        >
          Your exact location could not be
          accessed. Results are being calculated
          from the Mysuru fallback location.
        </div>
      )}


      {/* Interactive map */}

      <InteractiveMapSection
        selectedPharmacyId={selectedId}
        onSelectPharmacy={setSelectedId}
        pharmacies={pharmacies}
        center={
          location
            ? [
              location.lat,
              location.lng,
            ]
            : undefined
        }
      />

      <Divider className="my-0" />


      {/* Results and details */}

      <div
        className="grid grid-cols-1
                   items-start gap-5
                   lg:grid-cols-[1fr_320px]"
      >
        <div className="flex flex-col gap-5">
          {kendrasQuery.isLoading ? (
            <p
              className="py-10 text-center
                         text-sm text-slate-400"
            >
              {pmbiCode
                ? 'Ranking Kendras using your preferences…'
                : 'Finding nearby Kendras…'}
            </p>
          ) : kendrasQuery.isError ? (
            <div className="py-10 text-center">
              <p
                className="text-sm
                           text-danger-600"
              >
                Could not load nearby Kendras.
              </p>

              <button
                type="button"
                onClick={() =>
                  kendrasQuery.refetch()
                }
                className="mt-3 rounded-lg
                           bg-primary-600
                           px-4 py-2 text-xs
                           font-semibold text-white
                           hover:bg-primary-700"
              >
                Try Again
              </button>
            </div>
          ) : pharmacies.length === 0 ? (
            <div
              className="rounded-xl border
                         border-slate-200
                         bg-white px-5 py-10
                         text-center"
            >
              <p
                className="text-sm font-semibold
                           text-slate-700"
              >
                No Kendras found
              </p>

              <p
                className="mt-1 text-xs
                           text-slate-500"
              >
                No nearby Kendra currently has
                this medicine in stock.
              </p>
            </div>
          ) : (
            <NearbyPharmacyList
              pharmacies={pharmacies}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onViewDetails={
                handleViewDetails
              }
            />
          )}


        </div>


        {/* Right-side information */}

        <div
          className="flex flex-col gap-5
                     lg:sticky lg:top-16"
        >
          <PharmacyDetailsPanel
            pharmacyId={selectedId}
          />

          <PharmacyWorkflowTimeline />
        </div>
      </div>

      <Divider className="my-0" />

      <PharmacyTips />

      <HealthcareDisclaimer />
    </article>
  )
}


export default NearbyPharmaciesPage