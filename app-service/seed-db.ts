import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    // 1. Define the Matrix User ID who owns this system
    // REPLACE THIS with the user you create! e.g. @admin:localhost
    const OWNER_ID = "@chiarastellata:localhost"; 

    console.log(`Seeding database for owner: ${OWNER_ID}...`);

    // 2. Create the System
    const system = await prisma.system.upsert({
        where: { ownerId: OWNER_ID },
        update: {},
        create: {
            ownerId: OWNER_ID,
            name: "Test System",
            members: {
                create: [
                    {
                        name: "Lily",
                        displayName: "Lily 🌸",
                        avatarUrl: "mxc://localhost/FEjbXVVMcuGXyuFLmMfgjsLL", 
                        proxyTags: [
                            { prefix: "[Lily]" },
                            { prefix: "l;", suffix: "" } 
                        ]
                    },
                    {
                        name: "John",
                        displayName: "John 🛡️",
                        proxyTags: [
                            { prefix: "[John]" }
                        ]
                    }
                ]
            }
        }
    });

    console.log("Created System:", system);

    // 3. Update Lily's avatar if she exists
    await prisma.member.updateMany({
        where: { systemId: system.id, name: "Lily" },
        data: { avatarUrl: "mxc://localhost/FEjbXVVMcuGXyuFLmMfgjsLL" }
    });

    const members = await prisma.member.findMany({ where: { systemId: system.id } });
    console.log("Created Members:", members);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
