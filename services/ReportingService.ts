import {schedule} from 'node-cron';
import type {Client} from "discord.js";
import dayjs from "dayjs";
import {PointsRole, PointsRoles, TimeRole, TimeRoles} from "./constants/roles";
import {GuildMember} from "discord.js";
import {reportCurrentVotes} from "./CommunityAwardService";
import mongoose from "mongoose";
import {connect} from "./DataService";
import User from "../models/User";

interface IMemberDueForRank<T> {
    userId: string;
    nextRank: T;
}

const formatRankUpMessage = (members: Array<IMemberDueForRank<TimeRole | PointsRole> | undefined>) => {
    let message = 'We have some users ready to rank up!'
    members.forEach(member => {
        if (member) {
            message += `\n<@${member.userId}> -> ${member.nextRank.name}`
        }
    });
    console.log(message);
    return message;
}

const formatNotInClanMessage = (members: Array<GuildMember>) => {
    let message = 'The following members have the "Not In Clan" Role:'
    members.forEach(member => {
        if (member) {
            message += `\n<@${member.id}>`
        }
    });
    message += '\nOnce they are in the clan, please remove this role';
    console.log(message);
    return message;
}

const initializeReportMembersEligibleForTimeBasedRankUp = async (client: Client, reportingChannelId: string, serverId: string) => {
        console.log('Kicking off member rankup cron...');
        const server = client.guilds.cache.find(guild => guild.id === serverId);
        if (server) {
            const today = dayjs();
            // dont get from cache, we need an up to date list
            const currentMembers = await server.members.fetch();
            const membersDueForRank = currentMembers.filter(x => x.joinedAt !== null).map((member) => {
                // hard casting date since its not picking up on the filter
                const joinedDate = dayjs(member.joinedAt as Date);
                const monthsInServer = today.diff(joinedDate, 'month');
                const memberRoleIds = member.roles.cache.map(role => role.id);
                const currentRanks = TimeRoles.filter(x => memberRoleIds.includes(x.id));
                if (currentRanks && currentRanks.length) {
                    const highestRank = currentRanks.reduce((prev, current) => prev.order > current.order ? prev : current);
                    if (monthsInServer >= highestRank.maxMonths) {
                        const nextRank = TimeRoles.find(x => x.order === highestRank.order + 1);
                        // we can rank this user up!
                        if (nextRank) {
                            return {
                                userId: member.id,
                                nextRank: nextRank
                            } as IMemberDueForRank<TimeRole>
                        }
                    }
                }
            }).filter(x => x !== undefined);
            console.log(membersDueForRank)
            if (membersDueForRank && membersDueForRank.length) {
                const reportingChannel = client.channels.cache.get(reportingChannelId);
                if (reportingChannel && reportingChannel.isText()) {
                    const message = formatRankUpMessage(membersDueForRank)
                    try {
                        await reportingChannel.send(message);
                    } catch (e) {
                        console.log('Error sending rank up report to channel');
                        console.log(e);
                    }
                }
            }
        }
}

export const initializeReportMembersEligibleForPointsBasedRankUp = async (client: Client, reportingChannelId: string, serverId: string) => {
    if (mongoose.connection.readyState === 0) {
        await connect();
    }
    const server = client.guilds.cache.find(guild => guild.id === serverId);
    if (server) {
        const currentMembers = await server.members.fetch();
        const allInternalUsers = await User.find({});
        const rankUps = currentMembers.array().filter(allMember => allMember.roles.cache.array().filter(x =>  x.id === process.env.VERIFIED_ROLE_ID).length).map(member => {
            const existing = allInternalUsers.find(x => x.discordId === member.id);
            if (existing) {
                const currentPoints = existing.points;
                const roleBasedOnPoints = PointsRoles.find(x => currentPoints >= x.minPoints && currentPoints < x.maxPoints);
                const memberRoleIds = member.roles.cache.map(role => role.id);
                // they are the rank they should be
                if (memberRoleIds.find(x => x === roleBasedOnPoints?.id)) {
                    return;
                }
                return {
                    userId: member.id,
                    nextRank: roleBasedOnPoints
                } as IMemberDueForRank<PointsRole>
            }
        }).filter(x => x !== undefined && x.userId !== client.user?.id);
        console.log(`rank ups:`);
        console.log(rankUps);
        if (rankUps && rankUps.length) {
            const reportingChannel = client.channels.cache.get(reportingChannelId);
            if (reportingChannel && reportingChannel.isText()) {
                const message = formatRankUpMessage(rankUps)
                try {
                    await reportingChannel.send(message, {split: true});
                } catch (e) {
                    console.log('Error sending rank up report to channel');
                    console.log(e);
                }
            }
        }
    }

}

const initializeReportMembersNotInClan = async (client: Client, reportingChannelId: string, serverId: string, notInClanId: string) => {
    console.log('Kicking off member not in clan cron...');
    const server = client.guilds.cache.find(guild => guild.id === serverId);
    if (server) {
        const currentMembers = await server.members.fetch();
        const membersWithNotInClanRole = currentMembers.filter(x => x.roles.cache.some(y => y.id === notInClanId)).array();
        if (membersWithNotInClanRole.length) {
            const reportingChannel = client.channels.cache.get(reportingChannelId);
            if (reportingChannel && reportingChannel.isText()) {
                const message = formatNotInClanMessage(membersWithNotInClanRole);
                try {
                    await reportingChannel.send(message);
                } catch (e) {
                    console.log('Error sending not in clan report to channel');
                    console.log(e);
                }
            }
        }

    }
}

export const initializeNominationReport = async (client: Client, reportingChannelId: string, serverId: string) => {
    console.log('Kicking off award nomination report...');
    const server = client.guilds.cache.find(guild => guild.id === serverId);
    if (server) {
        const reportingChannel = client.channels.cache.get(reportingChannelId);
        if (reportingChannel && reportingChannel.isText()) {
            try {
                const report = await reportCurrentVotes();
                await reportingChannel.send(report, {split: true});
            } catch (e) {
                console.log(e);
            }
        }
    }
}

export const scheduleReportMembersEligibleForPointsRankUp = (client: Client, reportingChannelId: string, serverId: string) => {
    schedule('0 20 * * *',  async () => {
        try {
            await initializeReportMembersEligibleForPointsBasedRankUp(client, reportingChannelId, serverId)
        } catch (e) {
            console.log(e);
        }
    });
}

export const scheduleReportNominationResults = (client: Client, reportingChannelId: string, serverId: string) => {
    schedule('0 22 * * *',  async () => {
        try {
            await initializeNominationReport(client, reportingChannelId, serverId);
        } catch (e) {
            console.log(e);
        }
    });
}

export const scheduleReportMembersNotInClan = (client: Client, reportingChannelId: string, serverId: string, notInClanId: string) => {
    schedule('5 21 * * *',  async () => {
        try {
            await initializeReportMembersNotInClan(client, reportingChannelId, serverId, notInClanId)
        } catch (e) {
            console.log(e);
        }
    });
}
