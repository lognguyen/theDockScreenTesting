import { OfficeRnDDataAggregator } from './OfficeRnDDataAggregator';
import { AppBooking, OfficeRndBooking } from './OfficeRnDTypes/Booking';
import { OfficeRnDFloor } from './OfficeRnDTypes/Floor';
import { OfficeRndMeetingRoom } from './OfficeRnDTypes/MeetingRoom';
import { OfficeRnDMember } from './OfficeRnDTypes/Member';
import { OfficeRnDTeam } from './OfficeRnDTypes/Team';

const ONE_DAY_IN_MS = 1000 * 60 * 60 * 24; // 1 day
const DEFAULT_CACHE_TIME_IN_MS = 3 * ONE_DAY_IN_MS; // 3days
export class OfficeRnDService {
  BASE_API_URL = 'https://app.officernd.com/api/v1/organizations/thedock';
  access_token = '';

  aggregator = new OfficeRnDDataAggregator();

  private authenticate = async () => {
    if (this.access_token) {
      return this.access_token;
    }
    let fetchedData = await fetch(
      'https://identity.officernd.com/oauth/token',
      AuthOptions,
    ).then((response) => response.json()
    ).catch(error => {
      console.log('Error Fetching Data: ', error);
    }
    );
    const answer: { access_token: string; } = await fetchedData;
    this.access_token = answer.access_token;
    return this.access_token;
  };

  private rawFetchWithToken = async <T extends {}>(url: string) => {
    const token = await this.authenticate();
    let fetchedData = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'insomnia/2023.5.8',
        Authorization: 'Bearer ' + token,
      },
    });
    return fetchedData;
  };

  private fetchWithToken = async <T extends {}>(url: string) => {
    let fetchedData = await this.rawFetchWithToken(url);
    if (fetchedData.status > 400) {
      throw new Error("Tried to fetch something that doesn't exist. Error Code: "
        + fetchedData.status + ". Status Text: " + fetchedData.statusText
        + ". More Details: " + JSON.stringify(fetchedData.body));
    }
    return (await fetchedData.json()) as T;
  };

  cachedData: Record<string, { data: any; cachingTimestamp: number; }> = {};
  private fetchWithTokenAndCache = async <T extends {}>(
    url: string,
    defaultCacheDuration = DEFAULT_CACHE_TIME_IN_MS,
  ) => {
    if (this.cachedData[url]) {
      if (
        Date.now() - this.cachedData[url].cachingTimestamp <
        defaultCacheDuration
      ) {
        return this.cachedData[url].data as T;
      }
    }
    const data = await this.fetchWithToken<T>(url);
    this.cachedData[url] = { data, cachingTimestamp: Date.now() };
    return data;
  };

  private getEvents = async (dateStart: string, dateEnd: string) => {
    let fetchedData = await this.fetchWithToken<OfficeRndBooking[]>(
      `${this.BASE_API_URL}/bookings?seriesStart.$gte=` +
      dateStart +
      '&seriesStart.$lte=' +
      dateEnd,
    );
    return fetchedData;
  };

  private filterCanceledEvents = (events: OfficeRndBooking[]) => {
    return events.filter((event) => !event.canceled);
  };

  getEventsWithMeetingRoomsAndHostingTeam = async (
    dateStart: string,
    dateEnd: string,
  ): Promise<AppBooking[]> => {
    const floors = await this.getFloors();
    const meetingRooms = await this.getMeetingRooms();
    const allEvents = await this.getEvents(dateStart, dateEnd);
    const events = this.filterCanceledEvents(allEvents);
    const teams = await this.getTeams(events);
    const members = await this.getMembers(events);
    return this.aggregator.combineOfficeRnDDataIntoAppBookings(
      floors,
      meetingRooms,
      events,
      teams,
      members,
    );
  };

  private getMeetingRooms = async () => {
    let meetingRooms = await this.fetchWithTokenAndCache<
      OfficeRndMeetingRoom[]
    >(`${this.BASE_API_URL}/resources?type=meeting_room`);
    return meetingRooms;
  };

  private getFloors = async () => {
    let floorsArray = await this.fetchWithTokenAndCache<OfficeRnDFloor[]>(
      `${this.BASE_API_URL}/floors`,
    );
    return floorsArray;
  };

  private getTeams = async (bookings: OfficeRndBooking[]) => {
    const teamPromises = bookings
      .filter((booking) => booking.team)
      .map<Promise<OfficeRnDTeam>>((booking) => {
        return this.getTeam(booking);
      });
    return Promise.all(teamPromises);
  };

  private getTeam = (booking: OfficeRndBooking) => {
    return this.fetchWithTokenAndCache<OfficeRnDTeam>(
      `${this.BASE_API_URL}/teams/${booking.team}`,
    );
  };

  private getMembers = async (bookings: OfficeRndBooking[]) => {
    const memberPromises = bookings
      .filter((booking) => booking.member)
      .map<Promise<OfficeRnDMember>>((booking) => {
        return this.getMember(booking);
      });
    return Promise.all(memberPromises);
  };

  private getMember = async (
    booking: OfficeRndBooking,
  ): Promise<OfficeRnDMember> => {
    return this.fetchWithTokenAndCache<OfficeRnDMember>(
      `${this.BASE_API_URL}/members/${booking.member}`,
    );
  };
}

const AuthOptions = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'insomnia/2023.5.8',
  },
  body: new URLSearchParams({
    client_id: process.env.client_id as string,
    client_secret: process.env.client_secret as string,
    grant_type: 'client_credentials',
    scope: 'officernd.api.read',
  }),
};
